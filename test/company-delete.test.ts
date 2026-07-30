import { describe, it, expect, vi, beforeEach } from 'vitest';

// DELETE /api/admin/companies/:id — refuses unless the company holds nothing but
// its own audit rows; deletes the fresh-created husk cleanly. Mocks prisma +
// the platform-admin gate; calls the route handler directly.
const db = vi.hoisted(() => ({ company: { findUnique: vi.fn(), delete: vi.fn() } }));
const authz = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }));
vi.mock('../lib/db', () => ({ prisma: db }));
vi.mock('../lib/authz', () => ({ requirePlatformAdmin: authz.requirePlatformAdmin }));

import { DELETE } from '../app/api/admin/companies/[id]/route';

const params = { params: { id: 'c1' } };
const req = (qs = '') => new Request(`https://x.test/api/admin/companies/c1${qs}`, { method: 'DELETE' });

const ZERO = { trademarks: 0, users: 0, families: 0, inboundEmails: 0, notifications: 0, breeQueryLogs: 0, approvals: 0, watchNotices: 0, portfolioImports: 0, auditLogs: 0 };
const company = (over: any = {}) => ({
  id: 'c1', name: 'Test Co', clerkOrgId: null, alertPreference: null,
  _count: { ...ZERO, ...(over._count ?? {}) },
  ...('clerkOrgId' in over ? { clerkOrgId: over.clerkOrgId } : {}),
  ...('alertPreference' in over ? { alertPreference: over.alertPreference } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  authz.requirePlatformAdmin.mockResolvedValue({ id: 'u_admin' });
  db.company.delete.mockResolvedValue({});
});

describe('auth + existence', () => {
  it('403 when not a platform admin', async () => {
    authz.requirePlatformAdmin.mockResolvedValue(null);
    expect((await DELETE(req(), params)).status).toBe(403);
    expect(db.company.delete).not.toHaveBeenCalled();
  });
  it('404 when the company does not exist', async () => {
    db.company.findUnique.mockResolvedValue(null);
    expect((await DELETE(req(), params)).status).toBe(404);
  });
});

describe('deletes the clean fresh-created case', () => {
  it('all relations zero (bar its own audit rows) → 200, cascade delete called', async () => {
    db.company.findUnique.mockResolvedValue(company({ _count: { ...ZERO, auditLogs: 1 } })); // 1 create-audit row, tolerated
    const r = await DELETE(req(), params);
    expect(r.status).toBe(200);
    expect(db.company.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    const j = await r.json();
    expect(j.deleted).toBe(true);
    expect(j.auditRowsRemoved).toBe(1);
  });
});

describe('refuses on each non-empty relation', () => {
  it.each([
    'trademarks', 'users', 'families', 'inboundEmails', 'notifications',
    'breeQueryLogs', 'approvals', 'watchNotices', 'portfolioImports',
  ])('non-empty %s → 409, no delete', async (rel) => {
    db.company.findUnique.mockResolvedValue(company({ _count: { ...ZERO, [rel]: 2 } }));
    const r = await DELETE(req(), params);
    expect(r.status).toBe(409);
    expect((await r.json()).blockers.length).toBeGreaterThan(0);
    expect(db.company.delete).not.toHaveBeenCalled();
  });

  it('an alert preference → 409', async () => {
    db.company.findUnique.mockResolvedValue(company({ alertPreference: { id: 'ap1' } }));
    expect((await DELETE(req(), params)).status).toBe(409);
    expect(db.company.delete).not.toHaveBeenCalled();
  });
});

describe('linked Clerk org', () => {
  it('refused without force → 409 LINKED_ORG', async () => {
    db.company.findUnique.mockResolvedValue(company({ clerkOrgId: 'org_x' }));
    const r = await DELETE(req(), params);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('LINKED_ORG');
    expect(db.company.delete).not.toHaveBeenCalled();
  });
  it('deleted with ?force=true → 200', async () => {
    db.company.findUnique.mockResolvedValue(company({ clerkOrgId: 'org_x' }));
    const r = await DELETE(req('?force=true'), params);
    expect(r.status).toBe(200);
    expect(db.company.delete).toHaveBeenCalled();
  });
});
