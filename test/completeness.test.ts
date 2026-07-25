import { describe, it, expect } from 'vitest';
import { computeCompleteness, isRegistrySynced } from '../lib/completeness';
import type { Trademark } from '../types/trademark';

const base = {
  id: 'tm1',
  registry_name: 'UKIPO',
  mark_text: 'ASOS',
  status: 'Registered',
  application_number: 'UK00003207900',
  registration_number: 'UK00003207900',
  filing_date: '2017-01-01',
  registration_date: '2017-06-01',
  expiry_date: '2027-01-01',
  good_and_services: [{ search_class: { number: 25 }, text: 'Clothing' }],
  family_id: null,
} as unknown as Trademark;

const synced = { ...base, registry_status_raw: 'Registered' } as Trademark;
const handEntered = { ...base } as Trademark;

describe('isRegistrySynced', () => {
  it('reads provenance off the verbatim registry status', () => {
    expect(isRegistrySynced(synced)).toBe(true);
    expect(isRegistrySynced(handEntered)).toBe(false);
  });
});

describe('computeCompleteness', () => {
  it('does not ask a registry-synced mark for a client/agent', () => {
    const c = computeCompleteness(synced);
    expect(c.missing).not.toContain('Client / agent');
    expect(c.total).toBe(7);
  });

  it('still asks a hand-entered mark for a client/agent', () => {
    const c = computeCompleteness(handEntered);
    expect(c.missing).toContain('Client / agent');
    expect(c.total).toBe(8);
  });

  it('keeps asking for Family, which is a genuine gap', () => {
    expect(computeCompleteness(synced).missing).toContain('Family');
  });

  it('counts a registry-synced mark complete once family is set', () => {
    const c = computeCompleteness({ ...synced, family_id: 'fam1' } as Trademark);
    expect(c.missing).toEqual([]);
    expect(c.pct).toBe(100);
  });

  it('still reports a missing registration number', () => {
    const c = computeCompleteness({ ...synced, registration_number: undefined } as Trademark);
    expect(c.missing).toContain('Registration no.');
  });

  it('never exceeds 100 percent', () => {
    for (const t of [synced, handEntered]) expect(computeCompleteness(t).pct).toBeLessThanOrEqual(100);
  });
});

describe('device-mark image is not a completeness gap', () => {
  it('does not prompt for an image on a mark without one', () => {
    const c = computeCompleteness({ ...synced, family_id: 'fam1' } as Trademark);
    expect(c.missing.join(' ').toLowerCase()).not.toContain('image');
  });
});
