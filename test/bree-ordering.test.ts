import { describe, it, expect } from 'vitest';
import { orderByGoverningDeadline, soonestRank, deadlineRank } from '../lib/bree-ordering';
import * as bree from '../lib/bree-messages';

type Row = { registry: string; status: string; nextDeadline?: { type: string; dueDate: string; daysRemaining: number } };
const row = (registry: string, days?: number): Row => ({
  registry,
  status: 'Registered',
  nextDeadline: days === undefined ? undefined : { type: 'Renewal', dueDate: '2026-11-03', daysRemaining: days },
});
const days = (r: Row) => r.nextDeadline?.daysRemaining;

describe('deadlineRank', () => {
  it('ranks a real deadline by its days remaining', () => {
    expect(deadlineRank(99)).toBe(99);
    expect(deadlineRank(0)).toBe(0);
  });

  it('ranks anything without a deadline last', () => {
    expect(deadlineRank(null)).toBe(Number.POSITIVE_INFINITY);
    expect(deadlineRank(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(deadlineRank(NaN)).toBe(Number.POSITIVE_INFINITY);
  });

  // Callers filter to dueDate >= now, so this should not arise. If it ever
  // does, an overdue obligation must lead, not trail.
  it('ranks an overdue deadline ahead of everything', () => {
    expect(deadlineRank(-5)).toBeLessThan(deadlineRank(0));
  });
});

describe('orderByGoverningDeadline', () => {
  it('puts the soonest deadline first', () => {
    const out = orderByGoverningDeadline([row('WIPO', 400), row('UKIPO', 99), row('EUIPO', 250)], days);
    expect(out.map((r) => r.registry)).toEqual(['UKIPO', 'EUIPO', 'WIPO']);
  });

  it('puts rights with no upcoming deadline last, without dropping them', () => {
    const out = orderByGoverningDeadline([row('IPOS'), row('UKIPO', 99), row('USPTO')], days);
    expect(out.map((r) => r.registry)).toEqual(['UKIPO', 'IPOS', 'USPTO']);
    expect(out).toHaveLength(3);
  });

  it('keeps the caller order for equal deadlines, so ties break alphabetically', () => {
    const out = orderByGoverningDeadline([row('EUIPO', 120), row('UKIPO', 120), row('WIPO', 120)], days);
    expect(out.map((r) => r.registry)).toEqual(['EUIPO', 'UKIPO', 'WIPO']);
  });

  it('does not mutate the input', () => {
    const input = [row('WIPO', 400), row('UKIPO', 99)];
    orderByGoverningDeadline(input, days);
    expect(input.map((r) => r.registry)).toEqual(['WIPO', 'UKIPO']);
  });

  it('handles empty and single-item lists', () => {
    expect(orderByGoverningDeadline([], days)).toEqual([]);
    expect(orderByGoverningDeadline([row('UKIPO', 99)], days)).toHaveLength(1);
  });
});

describe('soonestRank', () => {
  it('reports the most urgent member of a group', () => {
    expect(soonestRank([row('WIPO', 400), row('UKIPO', 99)], days)).toBe(99);
  });

  it('reports no-deadline when nothing in the group has one', () => {
    expect(soonestRank([row('WIPO'), row('UKIPO')], days)).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports no-deadline for an empty group', () => {
    expect(soonestRank([], days)).toBe(Number.POSITIVE_INFINITY);
  });
});

/**
 * The rehearsal finding, as a regression test: ten TOPSHOP rights where the
 * most urgent one (a 99-day UKIPO renewal) sits sixth when the list is
 * registry-alphabetical.
 */
describe('the /bree status TOPSHOP case', () => {
  // Registry-alphabetical, which is what the reply used to be ordered by.
  const alphabetical: Row[] = [
    row('EUIPO', 2900),
    row('IP Australia', 760),
    row('IPOS', 890),
    row('JPO'),
    row('KIPO'),
    row('UKIPO', 99),
    row('UKIPO', 3400),
    row('USPTO', 240),
    row('WIPO', 180),
    row('WIPO', 1500),
  ];

  it('buried the urgent renewal sixth before the fix', () => {
    const urgent = alphabetical.findIndex((r) => r.nextDeadline?.daysRemaining === 99);
    expect(urgent).toBe(5); // sixth of ten
  });

  it('leads with the urgent renewal after the fix', () => {
    const out = orderByGoverningDeadline(alphabetical, days);
    expect(out[0].nextDeadline?.daysRemaining).toBe(99);
    expect(out[0].registry).toBe('UKIPO');
  });

  it('orders the whole reply by urgency and trails the undated rights', () => {
    const out = orderByGoverningDeadline(alphabetical, days);
    expect(out.map((r) => r.nextDeadline?.daysRemaining)).toEqual([
      99, 180, 240, 760, 890, 1500, 2900, 3400, undefined, undefined,
    ]);
  });

  it('renders the urgent right in the first line of the Slack message', () => {
    const out = orderByGoverningDeadline(alphabetical, days);
    const msg = bree.markStatusMsg({ query: 'TOPSHOP', groups: [{ markText: 'TOPSHOP', rows: out }] });
    const body = JSON.stringify(msg.blocks);
    const firstLine = body.slice(body.indexOf('TOPSHOP')).split('\\n')[1];
    expect(firstLine).toContain('99d');
  });
});

/** A multi-name match must not bury an urgent right under a calmer mark name. */
describe('group ordering across mark names', () => {
  const groups = [
    { markText: 'TOPSHOP UNIQUE', rows: [row('UKIPO', 4600)] },
    { markText: 'TOPSHOP', rows: [row('UKIPO', 99), row('EUIPO', 2900)] },
  ];

  it('leads with the mark holding the most urgent right', () => {
    const out = orderByGoverningDeadline(groups, (g) => soonestRank(g.rows, days));
    expect(out.map((g) => g.markText)).toEqual(['TOPSHOP', 'TOPSHOP UNIQUE']);
  });
});
