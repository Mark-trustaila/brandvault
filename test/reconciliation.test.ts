import { describe, it, expect } from 'vitest';
import {
  reconcileRenewal,
  discrepancyTooltip,
  isLiveStatus,
  sameDay,
} from '../lib/reconciliation';
import { reconcileObligations } from '../lib/deadlines';
import type { Obligation } from '../types/trademark';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const renewal = (due: string, windowMonths = 6): Obligation =>
  ({
    type: 'Renewal',
    desc: 'Renewal',
    dueDate: d(due),
    windowStart: new Date(d(due).getTime() - windowMonths * 30 * 86_400_000),
    daysUntil: 0,
    critical: true,
    actionable: false,
    overdue: false,
    inWindow: false,
    uncertain: false,
  }) as Obligation;

describe('sameDay', () => {
  it('ignores time of day', () => {
    expect(sameDay(new Date('2026-08-16T00:00:00Z'), new Date('2026-08-16T23:59:59Z'))).toBe(true);
    expect(sameDay(d('2026-08-16'), d('2026-08-17'))).toBe(false);
  });
});

describe('isLiveStatus', () => {
  it('counts marks still on the register as live', () => {
    for (const s of ['Registered', 'Published', 'Pending']) expect(isLiveStatus(s)).toBe(true);
    for (const s of ['Abandoned', 'Expired']) expect(isLiveStatus(s)).toBe(false);
  });
});

describe('reconcileRenewal — sources agree', () => {
  it('does not flag a discrepancy and lets the registry date govern', () => {
    const r = reconcileRenewal({
      registryExpiry: d('2027-03-01'),
      calculatedDue: d('2027-03-01'),
      status: 'Registered',
      now: NOW,
    });
    expect(r.datesDiffer).toBe(false);
    expect(r.governingDate).toEqual(d('2027-03-01'));
    expect(r.governingSource).toBe('registry');
    expect(r.overdue).toBe(false);
  });
});

describe('reconcileRenewal — sources differ', () => {
  it('the earlier future date governs when the registry is earlier', () => {
    const r = reconcileRenewal({
      registryExpiry: d('2026-08-16'),
      calculatedDue: d('2035-08-16'),
      status: 'Registered',
      now: NOW,
    });
    expect(r.datesDiffer).toBe(true);
    expect(r.governingDate).toEqual(d('2026-08-16'));
    expect(r.governingSource).toBe('registry');
    expect(r.overdue).toBe(false);
  });

  it('the earlier future date governs when the calculated date is earlier', () => {
    const r = reconcileRenewal({
      registryExpiry: d('2030-01-01'),
      calculatedDue: d('2027-06-01'),
      status: 'Registered',
      now: NOW,
    });
    expect(r.datesDiffer).toBe(true);
    expect(r.governingDate).toEqual(d('2027-06-01'));
    expect(r.governingSource).toBe('calculated');
  });
});

describe('reconcileRenewal — liveness guard', () => {
  it('a live mark with a past calculated date is governed by the registry and is not overdue', () => {
    const r = reconcileRenewal({
      registryExpiry: d('2026-08-16'),
      calculatedDue: d('2025-08-16'),
      status: 'Registered',
      now: NOW,
    });
    expect(r.governingDate).toEqual(d('2026-08-16'));
    expect(r.governingSource).toBe('registry');
    expect(r.overdue).toBe(false);
  });

  it('never reports overdue on a calculated date alone', () => {
    const r = reconcileRenewal({
      registryExpiry: null,
      calculatedDue: d('2025-08-16'),
      status: 'Registered',
      now: NOW,
    });
    expect(r.governingSource).toBe('calculated');
    expect(r.overdue).toBe(false);
  });

  it('does report overdue when the REGISTRY date has passed', () => {
    const r = reconcileRenewal({
      registryExpiry: d('2026-01-01'),
      calculatedDue: d('2026-02-01'),
      status: 'Registered',
      now: NOW,
    });
    expect(r.governingSource).toBe('registry');
    expect(r.overdue).toBe(true);
  });

  it('does report overdue on a past calculated date when the mark is not live', () => {
    const r = reconcileRenewal({
      registryExpiry: null,
      calculatedDue: d('2025-08-16'),
      status: 'Abandoned',
      now: NOW,
    });
    expect(r.overdue).toBe(true);
  });
});

describe('reconcileRenewal — missing data', () => {
  it('handles a mark with no registry expiry', () => {
    const r = reconcileRenewal({ registryExpiry: null, calculatedDue: d('2028-01-01'), status: 'Registered', now: NOW });
    expect(r.datesDiffer).toBe(false);
    expect(r.governingSource).toBe('calculated');
  });

  it('handles a mark with neither date', () => {
    const r = reconcileRenewal({ registryExpiry: null, calculatedDue: null, status: 'Registered', now: NOW });
    expect(r.governingDate).toBeNull();
    expect(r.governingSource).toBeNull();
    expect(r.datesDiffer).toBe(false);
    expect(r.overdue).toBe(false);
  });
});

describe('discrepancyTooltip', () => {
  const fmt = (x: Date) => x.toISOString().slice(0, 10);

  it('states both dates and contains no em dash', () => {
    const r = reconcileRenewal({ registryExpiry: d('2026-08-16'), calculatedDue: d('2035-08-16'), status: 'Registered', now: NOW });
    const text = discrepancyTooltip(r, fmt);
    expect(text).toBe(
      'Registry expiry 2026-08-16. Calculated renewal 2035-08-16. Dates differ: the earlier future date governs alerts.'
    );
    expect(text).not.toContain('—');
  });
});

describe('reconcileObligations', () => {
  it('leaves an aligned mark exactly as the engine produced it', () => {
    const obligations = [renewal('2027-03-01'), renewal('2037-03-01')];
    const out = reconcileObligations(obligations, d('2027-03-01'), 'Registered', NOW);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.dueDate)).toEqual([d('2027-03-01'), d('2037-03-01')]);
  });

  it('drops a drifted past renewal and adds the registry date (TOPMAN BRANDED shape)', () => {
    const obligations = [renewal('2025-08-16'), renewal('2035-08-16')];
    const out = reconcileObligations(obligations, d('2026-08-16'), 'Registered', NOW);
    const dues = out.map((o) => (o.dueDate as Date).toISOString().slice(0, 10)).sort();
    expect(dues).toEqual(['2026-08-16', '2035-08-16'].sort());
    // The earliest future row is the registry date, so that is what alerts see.
    expect(dues[0]).toBe('2026-08-16');
  });

  it('keeps a past renewal when the mark is not live', () => {
    const obligations = [renewal('2025-08-16')];
    const out = reconcileObligations(obligations, d('2026-08-16'), 'Abandoned', NOW);
    expect(out.map((o) => (o.dueDate as Date).toISOString().slice(0, 10))).toContain('2025-08-16');
  });

  it('never drops a non-renewal obligation, even a past one on a live mark', () => {
    // The liveness guard is about renewals only. A past Section 8 is a missed
    // filing, not date drift, and must survive reconciliation.
    const section8 = { ...renewal('2025-01-01'), type: 'Section 8 Declaration of Use' } as Obligation;
    const out = reconcileObligations([section8], d('2026-08-16'), 'Registered', NOW);
    expect(out.find((o) => o.type === 'Section 8 Declaration of Use')?.dueDate).toEqual(d('2025-01-01'));
  });

  it('adds the registry renewal when the engine produced no renewal at all', () => {
    // Registry expiry with no calculated series (unknown registry, or a series
    // beyond the engine horizon) still means a renewal falls due on that date.
    const section8 = { ...renewal('2025-01-01'), type: 'Section 8 Declaration of Use' } as Obligation;
    const out = reconcileObligations([section8], d('2026-08-16'), 'Registered', NOW);
    const added = out.filter((o) => o.type === 'Renewal');
    expect(added).toHaveLength(1);
    expect(added[0].dueDate).toEqual(d('2026-08-16'));
    // No renewal to borrow a window from, so the window opens on the due date
    // rather than inventing a span the registry's rules would not give it.
    expect(added[0].windowStart).toEqual(d('2026-08-16'));
  });

  it('is a no-op when the mark has no registry expiry', () => {
    const obligations = [renewal('2025-08-16'), renewal('2035-08-16')];
    const out = reconcileObligations(obligations, null, 'Registered', NOW);
    expect(out).toHaveLength(2);
  });

  it('gives the registry row the same early window the engine uses', () => {
    const obligations = [renewal('2035-08-16', 6)];
    const out = reconcileObligations(obligations, d('2026-08-16'), 'Registered', NOW);
    const added = out.find((o) => sameDay(o.dueDate as Date, d('2026-08-16')))!;
    const spanDays = ((added.dueDate as Date).getTime() - (added.windowStart as Date).getTime()) / 86_400_000;
    expect(spanDays).toBe(180);
  });

  it('drops uncertain obligations, as before', () => {
    const uncertain = { type: 'Renewal', desc: 'uncertain', dueDate: null, uncertain: true } as unknown as Obligation;
    const out = reconcileObligations([uncertain, renewal('2027-03-01')], d('2027-03-01'), 'Registered', NOW);
    expect(out).toHaveLength(1);
  });
});
