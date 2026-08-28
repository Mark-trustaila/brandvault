/**
 * The three defects the live facade exposed, pinned against the response that
 * exposed them.
 *
 * The fixture is not invented. test/fixtures/smart-search-gb-asos.json is a
 * verbatim subset of a real search — term "ASOS", classes 25,35, gb — captured
 * from the running facade on 2026-08-28, hit objects unedited. That matters:
 * the mock these components were built against encoded the §2.3 field names
 * from the contract, so it agreed with the client and proved nothing. Every
 * defect below is a field-name or semantics question only real data answered.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { hitMarkText, hitClasses, hitClassesLabel, type SmartSearchHit } from '../lib/smart-search-hit';

const fixture = JSON.parse(readFileSync('test/fixtures/smart-search-gb-asos.json', 'utf8'));
const hits: SmartSearchHit[] = fixture.results;

describe('the fixture is the live shape', () => {
  // If someone regenerates this file by hand to the contract's field names, the
  // tests below would pass against a lie. These assertions fail first.
  it('carries the facade normalisation, not the §2.3 wire names', () => {
    const h: any = hits[0];
    expect(h.mark).toBe('ASOS');
    expect(h.mark_string).toBeUndefined();
    expect(Array.isArray(h.classes)).toBe(true);
    expect(typeof h.class_match).toBe('boolean');
    expect(h.id).toBeUndefined();
  });

  it('preserves the §2.3 hit under raw', () => {
    const raw: any = (hits[0] as any).raw;
    expect(raw.mark_string).toBe('ASOS');
    expect(typeof raw.classes).toBe('string');
    expect(raw.class_match).toBe(1);
    expect(raw.registry).toBe('112');
    expect(typeof raw.id).toBe('string');
  });

  it('is a subset of a real 206-hit search, and says so', () => {
    expect(fixture.total_hits_in_live_response).toBe(206);
    expect(fixture._source).toMatch(/verbatim/i);
    expect(fixture.status).toBe('completed');
    expect(fixture.currencyDate).toBe('2026-07-11');
  });
});

// Defect 1. The panel read hit.mark_string, which the facade moved to
// hit.mark. Every one of 206 rows rendered "—" where the mark should be.
describe('hitMarkText', () => {
  it('finds the mark on every hit in the live response', () => {
    for (const h of hits) {
      expect(hitMarkText(h), `${h.application_number} has no readable mark`).not.toBe('');
    }
    expect(hitMarkText(hits[0])).toBe('ASOS');
  });

  it('reads the §2.3 flat name too, if a facade ever sends it', () => {
    expect(hitMarkText({ mark_string: 'BLOC' } as SmartSearchHit)).toBe('BLOC');
  });

  it('falls back to the preserved raw hit', () => {
    expect(hitMarkText({ raw: { mark_string: 'BLOC' } } as SmartSearchHit)).toBe('BLOC');
  });

  it('prefers the live name when both are present', () => {
    expect(hitMarkText({ mark: 'NEW', mark_string: 'OLD' } as SmartSearchHit)).toBe('NEW');
  });

  // Empty, not the string "undefined", so a caller's `|| '—'` works.
  it('is empty when there is no mark text anywhere', () => {
    expect(hitMarkText({} as SmartSearchHit)).toBe('');
  });
});

// Defect 2. The panel read hit.classes expecting §2.3's comma string and got an
// array, which React rendered run together as "3458914…".
describe('hitClasses', () => {
  it('reads the live array form', () => {
    expect(hitClasses(hits[0])).toEqual(
      ['3', '4', '5', '8', '9', '14', '16', '18', '20', '21', '24', '25', '26',
       '28', '35', '36', '38', '39', '41', '42', '45'],
    );
  });

  it('reads §2.3 comma string form to the same list', () => {
    const raw = (hits[0] as any).raw;
    expect(hitClasses({ classes: raw.classes } as SmartSearchHit)).toEqual(hitClasses(hits[0]));
  });

  it('renders as a readable list, never run together', () => {
    const label = hitClassesLabel(hits[0]);
    expect(label.startsWith('3, 4, 5, 8, 9')).toBe(true);
    expect(label).not.toMatch(/^\d{4,}/); // "3458914…" — what the array rendered as
  });

  // Displayed verbatim: what the register holds is what the reader sees, in the
  // order given. normaliseClasses sorts and drops out-of-range values, which is
  // right for a search being submitted and wrong for a record being shown.
  it('does not sort or filter the register\'s own list', () => {
    expect(hitClasses({ classes: ['35', '9', '99'] } as SmartSearchHit)).toEqual(['35', '9', '99']);
  });

  it('is empty, not broken, when a hit records no classes', () => {
    expect(hitClasses({} as SmartSearchHit)).toEqual([]);
    expect(hitClassesLabel({} as SmartSearchHit)).toBe('');
  });
});

// Defect 3. Score is a distance, not a similarity. The panel sorted descending.
describe('result ordering', () => {
  it('the facade leads with the exact match, at a LOW score', () => {
    expect(hitMarkText(hits[0])).toBe('ASOS');
    expect(hits[0].similarity).toBe('Very high');
    expect(hits[0].score).toBe(19);
  });

  it('sorting by score descending inverts the ranking', () => {
    const wrong = [...hits].sort((a, b) => b.score - a.score);
    // What the panel used to show first for a clearance search on ASOS.
    expect(hitMarkText(wrong[0])).toBe('EZEEZ');
    expect(wrong[0].score).toBe(50);
    // The exact match drops behind every less-similar hit. It does not land
    // dead last only because three others tie it at 19.
    const asosAt = wrong.findIndex((h) => hitMarkText(h) === 'ASOS');
    expect(asosAt).toBeGreaterThan(0);
    expect(wrong.slice(0, asosAt).every((h) => h.score > 19)).toBe(true);
  });

  // Source-level, in the spirit of test/viewer-write-gate.test.ts: the fix is
  // the absence of a sort, and an absence is easy to reintroduce by accident.
  it('the panel does not re-rank the facade\'s order', () => {
    const src = readFileSync('components/clearance/ResultsPanel.tsx', 'utf8');
    expect(src).not.toMatch(/\.sort\(/);
    expect(src).toContain('const hits = result.results ?? [];');
  });
});

// Boolean on the live wire, 1/0 in §2.3. The panel tests truthiness, so both
// work — but only if nothing starts comparing against 1.
describe('class_match', () => {
  it('is truthy in both forms', () => {
    expect(Boolean(hits[0].class_match)).toBe(true);
    expect(Boolean((hits[0] as any).raw.class_match)).toBe(true);
    expect(Boolean(0)).toBe(false);
    expect(Boolean(false)).toBe(false);
  });
});
