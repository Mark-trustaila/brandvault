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
import { CENTRE_FLOOR } from '../lib/layout';
import { readFileSync } from 'fs';
import { hitMarkText, hitClasses, hitClassesLabel, truncationNotice, type SmartSearchHit } from '../lib/smart-search-hit';

const fixture = JSON.parse(readFileSync('test/fixtures/smart-search-gb-asos.json', 'utf8'));
const truncatedFixture = JSON.parse(readFileSync('test/fixtures/smart-search-gb-truncated.json', 'utf8'));
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

  // A second search, independently captured, says the same thing more starkly:
  // the exact matches for LONDON score 0 and lead the facade's order, while
  // LANCIA — a different word — scores 65. Zero is as close as it gets.
  it('the LONDON capture confirms score is a distance, not a similarity', () => {
    const lonHits: SmartSearchHit[] = truncatedFixture.results;
    expect(hitMarkText(lonHits[0]).toUpperCase()).toBe('LONDON');
    expect(lonHits[0].score).toBe(0);
    expect(lonHits[0].similarity).toBe('Very high');
    const lancia = lonHits.find((h) => hitMarkText(h) === 'LANCIA');
    expect(lancia?.score).toBeGreaterThan(lonHits[0].score);
  });

  // Source-level, in the spirit of test/viewer-write-gate.test.ts: the fix is
  // the absence of a sort, and an absence is easy to reintroduce by accident.
  it('the panel does not re-rank the facade\'s order', () => {
    const src = readFileSync('components/clearance/ResultsPanel.tsx', 'utf8');
    expect(src).not.toMatch(/\.sort\(/);
    expect(src).toContain('const hits = useMemo(() => result?.results ?? [], [result]);');
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

/**
 * Truncation. The facade caps at RESULT_CAP and truncates rather than refusing,
 * because a clearance search loses less from a missing tail than from no answer
 * — but only if the tail is declared. A capped list that reads as a complete
 * search of the register is a false clear, which is the one wrong answer in
 * clearance that nobody catches.
 *
 * Pinned on the decision rather than on rendered JSX: the component is a thin
 * shell over truncationNotice(), so "renders the notice" and "renders none" are
 * exactly non-null and null here.
 */
describe('truncationNotice', () => {
  it('renders nothing for the live 206-hit search, which was not capped', () => {
    expect(fixture.truncated).toBe(false);
    expect(fixture.total_available).toBe(206);
    expect(truncationNotice(fixture)).toBeNull();
  });

  it('renders nothing when the field is absent altogether', () => {
    expect(truncationNotice({})).toBeNull();
    expect(truncationNotice({ result_count: 250, total_at_least: 250 })).toBeNull();
  });

  // A facade that sends something truthy-but-not-true must not be read as
  // "complete" — nor as a silent pass. Only exactly true warns.
  it('demands exactly true, not merely truthy', () => {
    expect(truncationNotice({ truncated: 1 as unknown as boolean })).toBeNull();
    expect(truncationNotice({ truncated: 'true' as unknown as boolean })).toBeNull();
    expect(truncationNotice({ truncated: false })).toBeNull();
  });

  // The facade counted the set and capped it itself. The reader can be told
  // exactly what is missing.
  describe('known total', () => {
    it('reports both counts and the facade cap', () => {
      expect(truncationNotice({ truncated: true, result_count: 2000, total_available: 4318, cap: 2000 }))
        .toEqual({ kind: 'known', shown: 2000, total: 4318, cap: 2000 });
    });

    it('falls back to the list length when the count is missing', () => {
      expect(truncationNotice({ truncated: true, total_available: 9, results: [1, 2, 3] }))
        .toEqual({ kind: 'known', shown: 3, total: 9, cap: null });
    });
  });

  // Upstream capped first, so the true total is unknowable. This is the shape
  // the deployed facade returns: total_available null, the floor in
  // total_at_least, the ceiling in upstream_cap.
  describe('unknown total', () => {
    it('matches the deployed probe: completed 250 None 250 250 True', () => {
      expect(truncatedFixture.result_count).toBe(250);
      expect(truncatedFixture.total_available).toBeNull();
      expect(truncatedFixture.total_at_least).toBe(250);
      expect(truncatedFixture.upstream_cap).toBe(250);
      expect(truncatedFixture.truncated).toBe(true);
      expect(truncationNotice(truncatedFixture))
        .toEqual({ kind: 'unknown', shown: 250, atLeast: 250, upstreamCap: 250 });
    });

    // The distinction is the whole point: result_count is not a total, and a
    // null total_available must never quietly become one.
    it('never presents the shown count as a total', () => {
      const n = truncationNotice(truncatedFixture);
      expect(n?.kind).toBe('unknown');
      expect(n).not.toHaveProperty('total');
    });

    it('survives a facade that sends neither floor nor ceiling', () => {
      expect(truncationNotice({ truncated: true, result_count: 250 }))
        .toEqual({ kind: 'unknown', shown: 250, atLeast: null, upstreamCap: null });
    });
  });

  // The envelope is no longer invented. It is a real capped response, and the
  // provenance note has to keep saying which search produced it — a fixture
  // that stops naming its own capture is one edit away from being fiction.
  it('is a genuine capture, and says which search produced it', () => {
    expect(truncatedFixture._source).toMatch(/GENUINE CAPTURE/);
    expect(truncatedFixture._source).not.toMatch(/SYNTHETIC/);
    expect(truncatedFixture._source).toMatch(/2026-08-28/);          // captured
    expect(truncatedFixture._source).toMatch(/42e1bc9/);             // deployed tip
    expect(truncatedFixture._source).toMatch(/"LONDON"/);            // the search
    expect(truncatedFixture.term).toBe('LONDON');
    expect(truncatedFixture.classes).toEqual(['35']);
    expect(truncatedFixture.total_hits_in_live_response).toBe(250);
  });

  // Fields the client discards but a verbatim capture keeps, so the fixture can
  // outlive the current normaliseResult.
  it('kept the whole wire envelope, not the client\'s view of it', () => {
    expect(truncatedFixture.upstream_status).toBe('Completed');
    expect(truncatedFixture).toHaveProperty('submitted_at');
    expect(truncatedFixture).toHaveProperty('apiVersion');
  });
});

/**
 * The panel after the workflow redesign (docs/clearance-workflow.md §4).
 *
 * Two rules changed deliberately and are pinned in their new form. Similarity
 * is gone from the table — the LawPanel string is a bucketed edit distance with
 * known bugs, and showing it beside the score invited a reader to trust the
 * word over the number. And the truncation rubric became one line under the
 * table: the fact belongs next to the list it truncated, not above it as a
 * three-paragraph warning nobody finishes.
 */
describe('the results table', () => {
  const src = readFileSync('components/clearance/ResultsPanel.tsx', 'utf8');

  it('leads on score and does not show similarity at all', () => {
    expect(src).toContain('>Score<');
    expect(src).not.toContain('>Similarity<');
    expect(src).not.toMatch(/hit\.similarity/);
  });

  it('marks the identical match rather than leaving it to be spotted', () => {
    expect(src).toContain('isExactMatch(hit)');
    expect(src).toContain('identical');
  });

  it('carries no results-count headline', () => {
    // A count above the table reads as a finding. The number is in the table.
    expect(src).not.toMatch(/\{hits\.length\}\s*\{?\s*hits\.length === 1/);
    expect(src).not.toContain('rated very high');
  });

  it('states the cap in one line, under the table', () => {
    expect(src).toContain('const notice = truncationNotice(result);');
    expect(src).toContain('shown;');
    expect(src.indexOf('</table>')).toBeLessThan(src.indexOf('shown;'));
  });

  it('offers the tier column and the bulk actions that fill it', () => {
    expect(src).toContain('>Tier<');
    expect(src).toContain('tierOf(reviews');
    expect(src).toContain('quickSelect(hits');
  });

  /**
   * Fitting the main column. It was an auto-layout table at min-width 860,
   * inside a column that is about 644px at 1280 and 804px at 1440: the browser
   * gave the wide cells what they asked for and cropped Tier to "TIE". A
   * cropped last column is worse than a scrollbar, because nothing tells you a
   * column was lost.
   */
  it('sizes its columns rather than letting the content bid for them', () => {
    expect(src).toContain('table-fixed');
    expect(src).toContain('<colgroup>');
    const cols = src.match(/<col[ /]/g) ?? [];
    const headers = src.match(/<th /g) ?? [];
    expect(cols.length, 'one col per column').toBe(headers.length);
  });

  it('is sized to the centre column\'s floor, not to a guess', () => {
    const min = Number(src.match(/min-w-\[(\d+)px\]/)?.[1]);
    expect(min).toBeLessThanOrEqual(CENTRE_FLOOR);
    expect(src).toContain('overflow-x-auto');
  });

  // Everything but the mark and owner is a fixed width, so the slack above the
  // floor goes to the column that can use it.
  it('leaves the mark and owner room at the floor', () => {
    const fixed = (src.match(/<col style=\{\{ width: (\d+) \}\} \/>/g) ?? [])
      .map((c) => Number(c.match(/(\d+)/)![1]))
      .reduce((a, b) => a + b, 0);
    expect(CENTRE_FLOOR - fixed).toBeGreaterThanOrEqual(150);
  });

  it('wraps the cells that would otherwise set the width', () => {
    for (const cell of ['break-words text-left font-medium', 'break-words text-xs text-slate-500', 'break-words text-slate-700']) {
      expect(src, cell).toContain(cell);
    }
  });
});

describe('the selection toolbar', () => {
  const src = readFileSync('components/clearance/ResultsPanel.tsx', 'utf8');

  // One line by construction, not by luck. Wrapping to a second row pushed the
  // table down and hid the Excluded control on the fold.
  it('cannot wrap to a second line', () => {
    expect(src).toContain('flex-nowrap');
    expect(src).not.toMatch(/flex flex-wrap items-center gap-2 rounded[^"]*bg-surface-muted/);
  });

  it('keeps every control at its natural width', () => {
    const qs = src.match(/const QS = '([^']*)'/)?.[1] ?? '';
    expect(qs).toContain('flex-none');
    expect(qs).toContain('whitespace-nowrap');
  });

  // Bulk tiering is the only reason the ticks exist, so it stays — as one
  // control rather than three, which is what made the row overflow.
  it('applies a tier in bulk from a single control', () => {
    expect(src).toContain('aria-label="Apply tier to selected"');
    expect(src).toContain('onTier(chosen, t)');
    expect(src).not.toMatch(/TIERS\.map\(\(t\) => \(\s*<button/);
  });
});
