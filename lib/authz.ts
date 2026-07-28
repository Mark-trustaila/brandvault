import { auth } from '@clerk/nextjs/server';
import type { Company, User } from '@prisma/client';
import { prisma } from './db';
import { resolveCompany, resolveUser } from './tenant';

export type RequestContext = {
  user: User;
  company: Company; // the company being acted on
  isPlatformAdmin: boolean;
  crossTenant: boolean; // platform admin acting outside their own org
};

export type ContextError = { status: number; message: string };

/** Methods that change data. GET/HEAD/OPTIONS read and are never gated here. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type RequestContextOptions = {
  /**
   * Let a viewer through on a mutating method.
   *
   * ONLY for endpoints where the verb is a transport detail rather than a write
   * to the portfolio: a query that needs a body, a per-user read receipt, a
   * message sent elsewhere. Never for anything that changes a mark, a note, a
   * family or a tenant's data.
   *
   * The default is denial, so a route added later is gated unless its author
   * opts out deliberately, in one visible place.
   */
  allowViewer?: boolean;
};

/**
 * Should this request be refused because a viewer is trying to write?
 *
 * Pure, so the matrix of verb x role can be pinned by tests rather than
 * inferred from the routes that happen to exist today.
 *
 * Platform admins are exempt regardless of their own row's role: cross-tenant
 * data correction is the entire point of the flag, and a platform admin whose
 * own membership resolved to viewer would otherwise be unable to onboard
 * anyone. `crossTenant` already governs which company they may touch.
 */
export function viewerWriteDenied(o: {
  method: string;
  role: User['role'];
  isPlatformAdmin: boolean;
  allowViewer?: boolean;
}): boolean {
  if (o.isPlatformAdmin) return false;
  if (o.allowViewer) return false;
  if (o.role !== 'viewer') return false;
  return MUTATING_METHODS.has((o.method ?? '').toUpperCase());
}

export const VIEWER_WRITE_MESSAGE = 'Viewers have read-only access and cannot change portfolio data';

/** The active Clerk org has no Company linked. Onboarding is concierge: a
 *  platform admin creates the company and links the org to it. */
export const ORG_NOT_LINKED_MESSAGE = 'This organization is not linked to a BrandVault company';

/** Sent when x-bv-company-id names a company that no longer exists. The client
 *  matches on this exact string to clear a stale acting company, so changing it
 *  means changing lib/client/acting-company.ts too (a test pins the pair). */
export const TARGET_COMPANY_MISSING_MESSAGE = 'Target company not found';

// Platform admins may target a company other than their active org by passing
// its id in this header (cross-tenant access for onboarding / data correction).
const COMPANY_HEADER = 'x-bv-company-id';

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return Boolean(await prisma.platformAdmin.findUnique({ where: { userId } }));
}

/**
 * Resolve who is acting and on which company for a write request.
 * - Normal users act on their active org's company.
 * - Platform admins may act cross-tenant via the x-bv-company-id header.
 * - A non-admin sending that header (for another company) is denied.
 * - Viewers are refused on mutating methods unless the caller opts out.
 *
 * The viewer check lives here rather than in each route so a route added later
 * inherits it. Enforcing it per-route means the gate is only as good as the
 * next author's memory, which is how POST/PATCH/DELETE /api/trademarks* came to
 * check no role at all.
 */
export async function getRequestContext(
  req: Request,
  options: RequestContextOptions = {}
): Promise<{ ctx: RequestContext; error?: undefined } | { ctx?: undefined; error: ContextError }> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return { error: { status: 403, message: 'No active organization' } };

  const homeCompany = await resolveCompany(orgId);
  if (!homeCompany) return { error: { status: 403, message: ORG_NOT_LINKED_MESSAGE } };
  const user = await resolveUser(userId, homeCompany.id, orgRole);
  const platformAdmin = await isPlatformAdmin(user.id);

  // Refused before the target company is resolved: a viewer has no business
  // writing to their own company or, via the header, to anyone else's.
  if (viewerWriteDenied({ method: req.method, role: user.role, isPlatformAdmin: platformAdmin, allowViewer: options.allowViewer })) {
    return { error: { status: 403, message: VIEWER_WRITE_MESSAGE } };
  }

  const targetId = req.headers.get(COMPANY_HEADER);
  if (targetId && targetId !== homeCompany.id) {
    if (!platformAdmin) return { error: { status: 403, message: 'Cross-tenant access denied' } };
    const target = await prisma.company.findUnique({ where: { id: targetId } });
    if (!target) return { error: { status: 404, message: TARGET_COMPANY_MISSING_MESSAGE } };
    return { ctx: { user, company: target, isPlatformAdmin: true, crossTenant: true } };
  }

  return { ctx: { user, company: homeCompany, isPlatformAdmin: platformAdmin, crossTenant: false } };
}

/**
 * The company a READ should be scoped to. Normally the active org's company;
 * for a platform admin with a valid x-bv-company-id, the target company
 * (cross-tenant view). A non-admin (or unknown target) safely falls back to the
 * home company — reads never leak across tenants. Null when there's no org.
 */
export async function getActingCompany(req: Request): Promise<Company | null> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return null;

  const home = await resolveCompany(orgId);
  if (!home) return null; // unlinked org: nothing to scope a read to
  const targetId = req.headers.get(COMPANY_HEADER);
  if (targetId && targetId !== home.id) {
    const user = await resolveUser(userId, home.id, orgRole);
    if (await isPlatformAdmin(user.id)) {
      const target = await prisma.company.findUnique({ where: { id: targetId } });
      if (target) return target;
    }
  }
  return home;
}

/** Platform-admin writes must carry a reason (audited). Returns an error string if invalid. */
export function requireReasonIfAdmin(ctx: RequestContext, reason: string | null): string | null {
  if (ctx.isPlatformAdmin && !reason) {
    return 'A reason is required for platform-admin edits';
  }
  return null;
}
