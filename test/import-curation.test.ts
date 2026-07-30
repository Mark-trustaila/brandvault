import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mark-level curation: prepareImport writes exactly the selected application
// numbers; unticked in-scope marks are out of scope (NOT stale); stale is
// measured against the full registry result. Same mock pattern as the other
// import tests.
const db = vi.hoisted(() => ({
  company: { findUnique: vi.fn() },
  trademark: { findMany: vi.fn() },
}));
const facade = vi.hoisted(() => ({ getMarks: vi.fn() }));
vi.mock('../lib/db', () => ({ prisma: db }));
vi.mock('../lib/registry-facade', () => ({ getMarks: facade.getMarks }));

import { prepareImport } from '../lib/import-portfolio';

const mark = (app: string, owner = 'ASOS plc', o: { device?: boolean; status?: string } = {}) => ({
  application_number: app,
  mark_text: o.device ? [] : [`MARK-${app}`],
  status: o.status ?? 'Registered',
  series_prefix: app.slice(0, 5),
  mark_feature: o.device ? 'Figurative' : 'Word',
  kind_mark: 'Word',
  doc_name: `${app}.xml`,
  matched_via: ['owner'],
  matched_owner_strings: [owner],
  dates: [
    { path: 'TradeMark/ApplicationDateTime', value: '2020-01-15T00:00:00.000Z' },
    { path: 'TradeMark/RegistrationDate', value: '2020-06-01Z' },
  ],
  goods_services: [{ class_number: '9', description: 'sw' }],
  applicants: [[{ field: 'Applicant/Name', value: owner }]],
  representatives: [],
  all_leaf_elements: [],
});

const marksDoc = (marks: unknown[]) => ({
  registry: 'gb', currencyDate: '2026-07-24',
  coverage: { uk009: { partial: true, approxPct: 72, note: '' } },
  cap: 2000, requestedOwnerStrings: ['ASOS plc'], unmatchedOwnerStrings: [], export: {}, marks,
});

const existingRow = (app: string) => ({
  id: `t_${app}`, applicationNumber: app, status: 'Registered', registryStatusRaw: 'Registered', markText: 'x',
  _count: { goodsServices: 1, deadlines: 1 },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.company.findUnique.mockResolvedValue({ id: 'c1' });
  db.trademark.findMany.mockResolvedValue([]);
});

describe('selection writes exactly the ticked subset', () => {
  it('N selected → mapped is exactly N; snapshot + predicted reflect the selection; inScope holds the full result', async () => {
    facade.getMarks.mockResolvedValue(marksDoc([mark('UK00000000001'), mark('UK00000000002'), mark('UK00000000003')]));
    const p = await prepareImport({ companySlug: 'c', ownerStrings: ['ASOS plc'], selectedApplicationNumbers: ['UK00000000001', 'UK00000000003'] });
    expect(p.mapped.map((m) => m.applicationNumber).sort()).toEqual(['UK00000000001', 'UK00000000003']);
    expect(p.predicted.marks).toBe(2);
    expect(p.predicted.goodsServices).toBe(2);
    expect(p.snapshot.marks).toHaveLength(2); // snapshot = the imported marks, not the owner set
    expect(p.inScope).toHaveLength(3); // full registry result, for the preview surface
  });
});

describe('unticked in-scope marks are out of scope, NOT stale', () => {
  it('stale = DB marks absent from the registry result; an unticked in-scope mark never appears there', async () => {
    // registry result = 1,2,3 ; DB holds 1 (matches) and 9 (absent from registry)
    db.trademark.findMany.mockResolvedValue([existingRow('UK00000000001'), existingRow('UK00000000009')]);
    facade.getMarks.mockResolvedValue(marksDoc([mark('UK00000000001'), mark('UK00000000002'), mark('UK00000000003')]));
    const p = await prepareImport({ companySlug: 'c', ownerStrings: ['ASOS plc'], selectedApplicationNumbers: ['UK00000000001'] });
    expect(p.mapped.map((m) => m.applicationNumber)).toEqual(['UK00000000001']);
    expect(p.plan.stale).toEqual(['UK00000000009']); // only the DB mark missing from the registry
    expect(p.plan.stale).not.toContain('UK00000000002'); // unticked in-scope is not stale
    expect(p.plan).toMatchObject({ toInsert: 0, toUpdate: 1 });
  });
});

describe('predicted counts follow the selection', () => {
  it('all vs one selected', async () => {
    facade.getMarks.mockResolvedValue(marksDoc([mark('UK00000000001'), mark('UK00000000002')]));
    const all = await prepareImport({ companySlug: 'c', ownerStrings: ['ASOS plc'] });
    expect(all.predicted.marks).toBe(2);
    const one = await prepareImport({ companySlug: 'c', ownerStrings: ['ASOS plc'], selectedApplicationNumbers: ['UK00000000002'] });
    expect(one.predicted.marks).toBe(1);
  });
});

describe('device marks carry the display convention', () => {
  it('empty verbal element → [device mark, no verbal element] <app>', async () => {
    facade.getMarks.mockResolvedValue(marksDoc([mark('UK00000000005', 'ASOS plc', { device: true })]));
    const p = await prepareImport({ companySlug: 'c', ownerStrings: ['ASOS plc'] });
    expect(p.mapped[0].markText).toBe('[device mark, no verbal element] UK00000000005');
  });
});

describe('fresh and existing companies both curate', () => {
  beforeEach(() => facade.getMarks.mockResolvedValue(marksDoc([mark('UK00000000001'), mark('UK00000000002')])));
  it('fresh company → selected mark inserts', async () => {
    db.company.findUnique.mockResolvedValue({ id: 'c_fresh' });
    db.trademark.findMany.mockResolvedValue([]);
    const p = await prepareImport({ companySlug: 'fresh', ownerStrings: ['ASOS plc'], selectedApplicationNumbers: ['UK00000000001'] });
    expect(p.plan).toMatchObject({ toInsert: 1, toUpdate: 0 });
  });
  it('existing company → selected mark updates in place', async () => {
    db.company.findUnique.mockResolvedValue({ id: 'c_exist' });
    db.trademark.findMany.mockResolvedValue([existingRow('UK00000000001')]);
    const p = await prepareImport({ companySlug: 'asos', ownerStrings: ['ASOS plc'], selectedApplicationNumbers: ['UK00000000001'] });
    expect(p.plan).toMatchObject({ toInsert: 0, toUpdate: 1 });
  });
});
