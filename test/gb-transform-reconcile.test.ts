import { describe, it, expect } from 'vitest';
import { transform, readExportDoc, NO_DEADLINE_STATUSES } from '../lib/gb-transform';

/**
 * The import path must reconcile before it persists.
 *
 * Two of the most urgent ASOS marks reached production holding one past row and
 * one a decade out, because the loader wrote the obligation engine's raw term
 * grid and the registry's own expiry date was never reconciled against it. The
 * alert engine could not see them and neither could AiLA. These pin the fix at
 * the point the rows are built, so a future import cannot reintroduce it.
 */

const NOW = new Date('2026-08-09T00:00:00.000Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A GB export mark in the shape the transform reads. */
const exportMark = (opts: {
  appNo: string;
  status: string;
  filing: string;
  registration?: string;
  expiry?: string;
}) => ({
  application_number: opts.appNo,
  mark_text: ['TESTMARK'],
  status: opts.status,
  series_prefix: opts.appNo.slice(0, 5),
  mark_feature: 'Word',
  kind_mark: 'Word',
  doc_name: `${opts.appNo}.xml`,
  matched_via: ['owner'],
  matched_owner_strings: ['ASOS plc'],
  dates: [
    { path: 'TradeMark/ApplicationDateTime', value: opts.filing },
    ...(opts.registration ? [{ path: 'TradeMark/RegistrationDate', value: opts.registration }] : []),
    ...(opts.expiry ? [{ path: 'TradeMark/ExpiryDate', value: opts.expiry }] : []),
  ],
  goods_services: [{ class_number: '25', description: 'clothing' }],
  applicants: [[{ field: 'Applicant/Name', value: 'ASOS plc' }]],
  representatives: [],
  all_leaf_elements: [],
});

const renewals = (m: ReturnType<typeof transform>) =>
  m.deadlines.filter((d) => d.type === 'Renewal').map((d) => iso(d.dueDate)).sort();

describe('gb-transform reconciles before persisting', () => {
  // The TOPMAN BRANDED / HOT SHOP shape: an old mark whose true expiry does not
  // sit on the engine's filing-date grid.
  it('persists the registry expiry as a row when the grid misses it', () => {
    const m = transform(
      exportMark({
        appNo: 'UK00001248483',
        status: 'Registered',
        filing: '1985-08-16T00:00:00.000Z',
        registration: '1988-01-01T00:00:00.000Z',
        expiry: '2026-08-16T00:00:00.000Z',
      }),
      NOW
    );

    expect(renewals(m)).toContain('2026-08-16');
  });

  it('leaves no past renewal governing a live mark the registry says is current', () => {
    const m = transform(
      exportMark({
        appNo: 'UK00001248483',
        status: 'Registered',
        filing: '1985-08-16T00:00:00.000Z',
        registration: '1988-01-01T00:00:00.000Z',
        expiry: '2026-08-16T00:00:00.000Z',
      }),
      NOW
    );

    const earliest = m.deadlines
      .map((d) => d.dueDate)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    expect(earliest.getTime()).toBeGreaterThan(NOW.getTime());
  });

  // Where the sources agree, reconciliation must be a no-op.
  it('does not disturb a mark whose calculated series already matches', () => {
    const args = {
      appNo: 'UK00009999999',
      status: 'Registered',
      filing: '2020-03-05T00:00:00.000Z',
      registration: '2020-09-01T00:00:00.000Z',
    } as const;
    const withoutExpiry = transform(exportMark(args), NOW);
    const onGrid = renewals(withoutExpiry)[0];

    const withExpiry = transform(exportMark({ ...args, expiry: `${onGrid}T00:00:00.000Z` }), NOW);
    expect(renewals(withExpiry)).toEqual(renewals(withoutExpiry));
  });

  // 'Withdrawn' maps to Abandoned, which is in NO_DEADLINE_STATUSES. Suppression
  // must still win over reconciliation: a future registry expiry on a dead mark
  // is not a reason to hand it a live renewal.
  it('still persists nothing for a suppressed status, future expiry or not', () => {
    const m = transform(
      exportMark({
        appNo: 'UK00001111111',
        status: 'Withdrawn',
        filing: '2015-01-01T00:00:00.000Z',
        expiry: '2027-01-01T00:00:00.000Z',
      }),
      NOW
    );
    expect(NO_DEADLINE_STATUSES.has(m.status)).toBe(true);
    expect(m.deadlines).toHaveLength(0);
  });

  it('reports needsData from the engine, not from reconciliation', () => {
    // No filing date at all: the engine cannot date the obligation.
    const m = transform(
      { ...exportMark({ appNo: 'UK00002222222', status: 'Registered', filing: '' }), dates: [] },
      NOW
    );
    expect(m.needsData).toBe(true);
  });
});

describe('readExportDoc clock threading', () => {
  // `.map(transform)` hands the callback the array index as its second argument,
  // which transform reads as `now`. That silently reconciles mark 0 against the
  // epoch and mark 1 against one millisecond later.
  it('passes a real date to every mark, not the array index', () => {
    const doc = {
      marks: [
        exportMark({ appNo: 'UK00001248483', status: 'Registered', filing: '1985-08-16T00:00:00.000Z', expiry: '2026-08-16T00:00:00.000Z' }),
        exportMark({ appNo: 'UK00001249798', status: 'Registered', filing: '1985-09-06T00:00:00.000Z', expiry: '2026-09-06T00:00:00.000Z' }),
      ],
    };

    const { mapped } = readExportDoc(doc, new Set(['ASOS plc']), NOW);

    expect(mapped).toHaveLength(2);
    // Reconciled against NOW, both keep a future registry row. Against an index
    // interpreted as a date (1970) the registry expiry is "future" too, but the
    // engine's long-past grid rows would survive the liveness guard, so the
    // earliest row would land in the past.
    for (const m of mapped) {
      const earliest = m.deadlines.map((d) => d.dueDate).sort((a, b) => a.getTime() - b.getTime())[0];
      expect(earliest.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});
