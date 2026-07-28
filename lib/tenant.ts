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
  const email =
    cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId)?.emailAddress ??
    cu.emailAddresses[0]?.emailAddress ??
    `${clerkUserId}@unknown.local`;
  const name = [cu.firstName, cu.lastName].filter(Boolean).join(' ') || email;
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
