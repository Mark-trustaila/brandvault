import { describe, it, expect, vi, beforeEach } from 'vitest';

// Prisma + Clerk mocks — hoisted so the vi.mock factories share the fn instances.
const db = vi.hoisted(() => ({
  company: { findUnique: vi.fn(), upsert: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  platformAdmin: { findUnique: vi.fn() },
}));
const clerk = vi.hoisted(() => ({
  auth: vi.fn(),
  organizations: { getOrganization: vi.fn() },
  users: { getUser: vi.fn() },
}));
vi.mock('../lib/db', () => ({ prisma: db }));
vi.mock('@clerk/nextjs/server', () => ({
  auth: clerk.auth,
  clerkClient: async () => ({ organizations: clerk.organizations, users: clerk.users }),
}));

import { resolveCompany, getCurrentUser } from '../lib/tenant';
import { getRequestContext, getActingCompany, ORG_NOT_LINKED_MESSAGE, TARGET_COMPANY_MISSING_MESSAGE } from '../lib/authz';
import { TARGET_COMPANY_MISSING, isStaleActingCompany } from '../lib/client/acting-company';

const ASOS = { id: 'cmr6ir', name: 'ASOS plc', slug: 'asos-plc', clerkOrgId: 'org_real' };
const req = (headers: Record<string, string> = {}, method = 'GET') =>
  new Request('https://example.test/api/x', { method, headers });

beforeEach(() => {
  vi.clearAllMocks();
  clerk.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_real', orgRole: 'org:admin' });
  db.user.findUnique.mockResolvedValue({ id: 'u1', role: 'admin', companyId: ASOS.id, clerkUserId: 'user_1' });
  db.platformAdmin.findUnique.mockResolvedValue(null);
});

/**
 * The husk-minting path, closed. resolveCompany used to insert a Company for
 * any unknown Clerk org, which is how a stray "Asos Plc" tenant appeared in
 * production. Onboarding is concierge: the company is created by a platform
 * admin and the org linked to it.
 */
describe('resolveCompany', () => {
  it('returns the linked company', async () => {
    db.company.findUnique.mockResolvedValue(ASOS);
    expect(await resolveCompany('org_real')).toEqual(ASOS);
  });

  it('returns null for an unlinked org', async () => {
    db.company.findUnique.mockResolvedValue(null);
    expect(await resolveCompany('org_unknown')).toBeNull();
  });

  it('never provisions a company for an unknown org', async () => {
    db.company.findUnique.mockResolvedValue(null);
    await resolveCompany('org_unknown');
    expect(db.company.upsert).not.toHaveBeenCalled();
    expect(db.company.create).not.toHaveBeenCalled();
  });

  // The old implementation asked Clerk for the org's name and slug in order to
  // build the row. Nothing should need that now.
  it('never asks Clerk about an unknown org', async () => {
    db.company.findUnique.mockResolvedValue(null);
    await resolveCompany('org_unknown');
    expect(clerk.organizations.getOrganization).not.toHaveBeenCalled();
  });
});

describe('unlinked org through the request paths', () => {
  beforeEach(() => db.company.findUnique.mockResolvedValue(null));

  it('getRequestContext refuses with a plain reason', async () => {
    const { ctx, error } = await getRequestContext(req({}, 'POST'));
    expect(ctx).toBeUndefined();
    expect(error).toEqual({ status: 403, message: ORG_NOT_LINKED_MESSAGE });
  });

  it('getActingCompany scopes reads to nothing rather than guessing', async () => {
    expect(await getActingCompany(req())).toBeNull();
  });

  it('getCurrentUser does not create a user with nowhere to put them', async () => {
    expect(await getCurrentUser()).toBeNull();
    expect(db.user.upsert).not.toHaveBeenCalled();
  });
});

describe('a linked org still works', () => {
  it('resolves the context normally', async () => {
    db.company.findUnique.mockResolvedValue(ASOS);
    const { ctx, error } = await getRequestContext(req({}, 'POST'));
    expect(error).toBeUndefined();
    expect(ctx?.company).toEqual(ASOS);
    expect(ctx?.crossTenant).toBe(false);
  });

  it('404s a cross-tenant target that no longer exists', async () => {
    db.company.findUnique.mockImplementation(({ where }: { where: { clerkOrgId?: string; id?: string } }) =>
      Promise.resolve(where.clerkOrgId === 'org_real' ? ASOS : null)
    );
    db.platformAdmin.findUnique.mockResolvedValue({ id: 'pa1', userId: 'u1' });
    const { error } = await getRequestContext(req({ 'x-bv-company-id': 'deleted_husk' }, 'POST'));
    expect(error).toEqual({ status: 404, message: TARGET_COMPANY_MISSING_MESSAGE });
  });
});

/**
 * The client clears a stale acting company on exactly that 404, which only
 * works while both sides agree on the wording.
 */
describe('stale acting company detection', () => {
  it('the client and server strings match', () => {
    expect(TARGET_COMPANY_MISSING).toBe(TARGET_COMPANY_MISSING_MESSAGE);
  });

  it('detects the server saying the target is gone', () => {
    expect(isStaleActingCompany(404, TARGET_COMPANY_MISSING_MESSAGE)).toBe(true);
  });

  // Narrow on purpose: routes 404 for missing notifications and marks all the
  // time, and clearing on those would eject an admin from the tenant they are
  // working in mid-task.
  it('ignores an unrelated 404', () => {
    expect(isStaleActingCompany(404, 'Notification not found')).toBe(false);
    expect(isStaleActingCompany(404, null)).toBe(false);
    expect(isStaleActingCompany(404, undefined)).toBe(false);
    expect(isStaleActingCompany(404, { error: 'x' })).toBe(false);
  });

  it('ignores the right message on the wrong status', () => {
    expect(isStaleActingCompany(403, TARGET_COMPANY_MISSING_MESSAGE)).toBe(false);
    expect(isStaleActingCompany(200, TARGET_COMPANY_MISSING_MESSAGE)).toBe(false);
  });
});
