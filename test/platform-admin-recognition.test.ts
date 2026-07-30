import { describe, it, expect, vi, beforeEach } from 'vitest';

// Same mock shape as tenant-resolution.test.ts (hoisted so factories share fns).
const db = vi.hoisted(() => ({
  company: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  platformAdmin: { findUnique: vi.fn() },
}));
const clerk = vi.hoisted(() => ({ auth: vi.fn(), users: { getUser: vi.fn() } }));
vi.mock('../lib/db', () => ({ prisma: db }));
vi.mock('@clerk/nextjs/server', () => ({
  auth: clerk.auth,
  clerkClient: async () => ({ users: clerk.users }),
}));

import { requirePlatformAdmin, getRequestContext, VIEWER_WRITE_MESSAGE } from '../lib/authz';

const ADMIN = { id: 'u_admin', email: 'mkw@mkwassoc.co.uk', role: 'admin', companyId: 'c1', clerkUserId: 'user_1' };
const req = (method = 'GET') => new Request('https://example.test/api/x', { method });

beforeEach(() => {
  vi.clearAllMocks();
  // Signed in; resolves to the admin row by clerkUserId.
  clerk.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_real', orgRole: 'org:admin' });
  db.user.findUnique.mockImplementation(({ where }: { where: { clerkUserId?: string; email?: string } }) =>
    Promise.resolve(where.clerkUserId === 'user_1' || where.email === ADMIN.email ? ADMIN : null),
  );
  db.platformAdmin.findUnique.mockResolvedValue({ id: 'pa1', userId: 'u_admin' }); // granted
});

/**
 * Recognition must NOT depend on the active org resolving to a company. These
 * three org contexts previously decided whether getCurrentUser returned the
 * user at all — which is the bug that 403'd a real platform admin.
 */
describe('requirePlatformAdmin — recognises the admin regardless of org context', () => {
  it('with the linked org active', async () => {
    db.company.findUnique.mockResolvedValue({ id: 'c1', clerkOrgId: 'org_real' });
    expect((await requirePlatformAdmin())?.id).toBe('u_admin');
  });

  it('with NO active org', async () => {
    clerk.auth.mockResolvedValue({ userId: 'user_1', orgId: null, orgRole: null });
    expect((await requirePlatformAdmin())?.id).toBe('u_admin');
    expect(db.company.findUnique).not.toHaveBeenCalled(); // never consults org→company
  });

  it('with an UNLINKED org active', async () => {
    clerk.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_unlinked', orgRole: 'org:admin' });
    db.company.findUnique.mockResolvedValue(null); // org not linked to any company
    expect((await requirePlatformAdmin())?.id).toBe('u_admin');
  });
});

/**
 * Same three contexts, but the user is not granted — must be null every time,
 * so decoupling recognition does not widen access.
 */
describe('requirePlatformAdmin — a non-admin is never recognised', () => {
  beforeEach(() => db.platformAdmin.findUnique.mockResolvedValue(null));
  it('linked org', async () => {
    db.company.findUnique.mockResolvedValue({ id: 'c1', clerkOrgId: 'org_real' });
    expect(await requirePlatformAdmin()).toBeNull();
  });
  it('no org', async () => {
    clerk.auth.mockResolvedValue({ userId: 'user_1', orgId: null });
    expect(await requirePlatformAdmin()).toBeNull();
  });
  it('unlinked org', async () => {
    clerk.auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_unlinked' });
    db.company.findUnique.mockResolvedValue(null);
    expect(await requirePlatformAdmin()).toBeNull();
  });
  it('not signed in', async () => {
    clerk.auth.mockResolvedValue({ userId: null });
    expect(await requirePlatformAdmin()).toBeNull();
  });
});

/**
 * The Clerk-instance-migration seam: the session id doesn't match any row, so
 * recognition falls back to the VERIFIED primary email. An unverified email
 * must never be adopted.
 */
describe('requirePlatformAdmin — verified-email fallback', () => {
  beforeEach(() => {
    clerk.auth.mockResolvedValue({ userId: 'user_newinstance', orgId: null });
    // clerkUserId lookup misses (id changed); only email matches.
    db.user.findUnique.mockImplementation(({ where }: { where: { clerkUserId?: string; email?: string } }) =>
      Promise.resolve(where.email === ADMIN.email ? ADMIN : null),
    );
  });

  it('recognises via a verified email when the clerk id changed', async () => {
    clerk.users.getUser.mockResolvedValue({
      primaryEmailAddressId: 'idn_1',
      emailAddresses: [{ id: 'idn_1', emailAddress: ADMIN.email, verification: { status: 'verified' } }],
    });
    expect((await requirePlatformAdmin())?.id).toBe('u_admin');
  });

  it('refuses an unverified email (no impersonation)', async () => {
    clerk.users.getUser.mockResolvedValue({
      primaryEmailAddressId: 'idn_1',
      emailAddresses: [{ id: 'idn_1', emailAddress: ADMIN.email, verification: { status: 'unverified' } }],
    });
    expect(await requirePlatformAdmin()).toBeNull();
    expect(db.user.findUnique).not.toHaveBeenCalledWith({ where: { email: ADMIN.email } });
  });
});

/**
 * Guard rail: the fix changes RECOGNITION only. The write/viewer gate lives in
 * getRequestContext and must still refuse a viewer's write — unchanged.
 */
describe('viewer write gate is untouched', () => {
  it('getRequestContext still refuses a viewer POST', async () => {
    clerk.auth.mockResolvedValue({ userId: 'user_v', orgId: 'org_real', orgRole: 'org:member' });
    db.company.findUnique.mockResolvedValue({ id: 'c1', name: 'ASOS plc', slug: 'asos-plc', clerkOrgId: 'org_real' });
    db.user.findUnique.mockResolvedValue({ id: 'u_v', role: 'viewer', companyId: 'c1', clerkUserId: 'user_v' });
    db.platformAdmin.findUnique.mockResolvedValue(null);
    const { ctx, error } = await getRequestContext(req('POST'));
    expect(ctx).toBeUndefined();
    expect(error).toEqual({ status: 403, message: VIEWER_WRITE_MESSAGE });
  });
});
