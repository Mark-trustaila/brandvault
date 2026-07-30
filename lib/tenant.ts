import { auth, clerkClient } from '@clerk/nextjs/server';
import type { Company, User } from '@prisma/client';
import { prisma } from './db';

/**
 * Tenancy — maps the Clerk session to our data model.
 *
 *   Clerk Organization  <->  Company   (by clerkOrgId)
 *   Clerk User          <->  User      (by clerkUserId)
 *
 * Rows are synced lazily on request (upsert); no webhooks yet. The resolve*
 * helpers take ids so they're testable outside a request; getCurrent* read the
 * active org/user from the Clerk session.
 */

/**
 * Clerk org role -> our UserRole.
 *
 * Clerk's default roles are org:admin and org:member. Members map to VIEWER,
 * not editor: an ordinary member of the org should not get write access to a
 * live portfolio by default, and a reviewer account added as a member was
 * silently landing as an editor of 222 production marks.
 *
 * Anything unrecognised also maps to viewer, so a custom Clerk role added
 * later fails closed rather than granting more than intended.
 *
 * Consequence worth knowing: `editor` is now unreachable through login. Setting
 * it by hand does not stick either, because resolveUser reconciles role on every
 * authenticated request and would restore viewer. Reaching editor again needs a
 * Clerk role that maps to it, added here deliberately.
 *
 * This mapping is a two-person-workspace expedient and the first real customer's
 * role scheme is expected to supersede it. See CLAUDE.md.
 */
function mapRole(orgRole?: string | null): 'admin' | 'editor' | 'viewer' {
  return orgRole === 'org:admin' ? 'admin' : 'viewer';
}

// Exported for tests: this mapping decides write access, so it is worth pinning.
export const __mapRoleForTest = mapRole;

/**
 * The Company linked to a Clerk org, or null when the org is not linked.
 *
 * Deliberately does NOT create one. It used to: an unknown org was fetched from
 * Clerk and a Company inserted for it. That contradicts the concierge
 * onboarding model, where a platform admin creates the company and links the
 * org to it, and it meant any Clerk org anyone created became a BrandVault
 * tenant on first request. It is how a stray "Asos Plc" company appeared in
 * production on 2026-07-28, minted by a sign-in against an unrelated org.
 *
 * Returning null instead makes an unlinked org a visible, recoverable state
 * rather than a silent second tenant that strands the real portfolio.
 */
export async function resolveCompany(orgId: string): Promise<Company | null> {
  return prisma.company.findUnique({ where: { clerkOrgId: orgId } });
}

export async function resolveUser(
  clerkUserId: string,
  companyId: string,
  orgRole?: string | null
): Promise<User> {
  const role = mapRole(orgRole);
  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) {
    if (existing.role !== role || existing.companyId !== companyId) {
      return prisma.user.update({ where: { id: existing.id }, data: { role, companyId } });
    }
    return existing;
  }
  const cu = await (await clerkClient()).users.getUser(clerkUserId);
  const primary = cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) ?? cu.emailAddresses[0];
  const email = primary?.emailAddress ?? `${clerkUserId}@unknown.local`;
  const name = [cu.firstName, cu.lastName].filter(Boolean).join(' ') || email;

  /**
   * Adopt an existing row with the same verified email rather than inserting.
   *
   * A Clerk instance migration gives the same person a new user id, so the
   * lookup above misses while `users.email` still holds their address. The
   * insert then violates that unique constraint, and the P2002 surfaces as an
   * unhandled 500 on every authenticated request that resolves a context —
   * which is every write, since only writes call this. Reads go through
   * getActingCompany, which skips resolveUser unless a cross-tenant header is
   * present, so the app looks healthy while nothing can be saved.
   *
   * Adopting keeps the row id, and with it the platform-admin grant, notes,
   * audit entries, notification reads and Bree query logs, all of which key on
   * users.id. Inserting a second row would orphan every one of them.
   *
   * Gated on the email being VERIFIED in Clerk. An unverified address must
   * never let one account take over another's row; Clerk requires verification
   * before an address can become primary, so this is belt and braces.
   */
  if (primary?.verification?.status === 'verified') {
    const sameEmail = await prisma.user.findUnique({ where: { email } });
    if (sameEmail) {
      return prisma.user.update({
        where: { id: sameEmail.id },
        data: { clerkUserId, role, companyId },
      });
    }
  }

  return prisma.user.upsert({
    where: { clerkUserId },
    update: { role, companyId },
    create: { clerkUserId, email, name, role, companyId },
  });
}

/** The active org's Company for this request, or null if no org is active. */
export async function getCurrentCompany(): Promise<Company | null> {
  const { orgId } = await auth();
  if (!orgId) return null;
  return resolveCompany(orgId);
}

/** The current user synced into the active org's company, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return null;
  const company = await resolveCompany(orgId);
  // Unlinked org: no company to attach the user to, and creating one here is
  // exactly the auto-provisioning this no longer does.
  if (!company) return null;
  return resolveUser(userId, company.id, orgRole);
}

/**
 * The signed-in BrandVault user, resolved INDEPENDENTLY of org context — for
 * RECOGNITION only (e.g. platform-admin gating). Unlike getCurrentUser it does
 * not require an active org, does not require that org to be linked to a
 * company, and returns NO acting company. It is read-only: it never creates or
 * adopts a row.
 *
 * Resolves by clerkUserId, falling back to a VERIFIED primary email. The email
 * fallback survives a Clerk instance migration (the id changes, the email is
 * stable) — the same seam getCurrentUser hit, which left a platform admin whose
 * active org didn't resolve unable to reach admin routes at all. The verified
 * gate mirrors resolveUser: an unverified address must never let one account be
 * recognised as another.
 */
export async function getSessionUser(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const byClerk = await prisma.user.findUnique({ where: { clerkUserId: userId } });
  if (byClerk) return byClerk;
  const cu = await (await clerkClient()).users.getUser(userId);
  const primary = cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId) ?? cu.emailAddresses[0];
  if (primary?.verification?.status !== 'verified' || !primary.emailAddress) return null;
  return prisma.user.findUnique({ where: { email: primary.emailAddress } });
}
