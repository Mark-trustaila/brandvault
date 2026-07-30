import { describe, it, expect, vi, beforeEach } from 'vitest';

// prepareImport resolves the target company by SLUG (selecting only id) and
// never reads clerkOrgId — so an admin-created, org-unlinked company is fully
// importable. These tests pin that: create-then-import a fresh company, the
// no-org state, and the existing-company path unchanged.
const db = vi.hoisted(() => ({
  company: { findUnique: vi.fn() },
  trademark: { findMany: vi.fn() },
}));
const facade = vi.hoisted(() => ({ getMarks: vi.fn() }));
vi.mock('../lib/db', () => ({ prisma: db }));
vi.mock('../lib/registry-facade', () => ({ getMarks: facade.getMarks }));

import { prepareImport, ImportAbortError } from '../lib/import-portfolio';

const mark = (app: string, owner = 'ASOS plc', status = 'Registered') => ({
  application_number: app,
  mark_text: ['TESTMARK'],
  status,
  series_prefix: app.slice(0, 5),
  mark_feature: 'Word',
  kind_mark: 'Word',
  doc_name: `${app}.xml`,
  matched_via: ['owner'],
  matched_owner_strings: [owner],
  dates: [
    { path: 'TradeMark/ApplicationDateTime', value: '2020-01-15T00:00:00.000Z' },
    { path: 'TradeMark/RegistrationDate', value: '2020-06-01Z' },
  ],
  goods_services: [{ class_number: '9', description: 'software' }],
  applicants: [[{ field: 'Applicant/Name', value: owner }]],
  representatives: [],
  all_leaf_elements: [],
});

const marksDoc = (marks: unknown[]) => ({
  registry: 'gb',
  currencyDate: '2026-07-24',
  coverage: { uk009: { partial: true, approxPct: 72, note: '' } },
  cap: 2000,
  requestedOwnerStrings: ['ASOS plc'],
  unmatchedOwnerStrings: [],
  export: {},
  marks,
});

beforeEach(() => {
  vi.clearAllMocks();
  facade.getMarks.mockResolvedValue(marksDoc([mark('UK00000000001')]));
});

describe('create-then-import: a fresh, org-unlinked company', () => {
  it('imports by slug alone — all inserts, no org linkage required', async () => {
    db.company.findUnique.mockResolvedValue({ id: 'c_fresh' }); // just created; clerkOrgId null, not selected here
    db.trademark.findMany.mockResolvedValue([]); // brand new: nothing held yet
    const p = await prepareImport({ companySlug: 'prospect-co', ownerStrings: ['ASOS plc'] });
    expect(p.companyId).toBe('c_fresh');
    expect(p.plan).toEqual({ toInsert: 1, toUpdate: 0, stale: [] });
    expect(p.predicted.marks).toBe(1);
  });

  it('resolves the company by { slug } selecting only id — clerkOrgId never enters the path', async () => {
    db.company.findUnique.mockResolvedValue({ id: 'c_fresh' });
    db.trademark.findMany.mockResolvedValue([]);
    await prepareImport({ companySlug: 'prospect-co', ownerStrings: ['ASOS plc'] });
    expect(db.company.findUnique).toHaveBeenCalledWith({ where: { slug: 'prospect-co' }, select: { id: true } });
  });
});

describe('existing-company path unchanged', () => {
  it('a company already holding the mark → update in place, zero inserts', async () => {
    db.company.findUnique.mockResolvedValue({ id: 'c_existing' });
    db.trademark.findMany.mockResolvedValue([
      { id: 't1', applicationNumber: 'UK00000000001', status: 'Registered', registryStatusRaw: 'Registered', markText: 'TESTMARK', _count: { goodsServices: 1, deadlines: 1 } },
    ]);
    const p = await prepareImport({ companySlug: 'asos-plc', ownerStrings: ['ASOS plc'] });
    expect(p.plan.toUpdate).toBe(1);
    expect(p.plan.toInsert).toBe(0);
    expect(p.plan.stale).toEqual([]);
  });
});

describe('guard', () => {
  it('unknown company slug → ImportAbortError, no write attempted', async () => {
    db.company.findUnique.mockResolvedValue(null);
    await expect(prepareImport({ companySlug: 'nope', ownerStrings: ['ASOS plc'] })).rejects.toBeInstanceOf(ImportAbortError);
    expect(db.trademark.findMany).not.toHaveBeenCalled();
  });
});
