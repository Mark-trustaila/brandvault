/**
 * The pure half of the clearance workflow: tiers, selection, the history
 * filter, and rendering a saved record through the live panel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  TIERS, DEFAULT_TIER, isTier, reviewMap, tierOf, isLive, isExactMatch,
  quickSelect, tierUpdates, matchesHistory, recordAsResult, describeHit,
  highlightOrder, highlightRank, reorderUpdates, clearOrderUpdates,
  type HistoryRow, type SavedRecordView,
} from '../lib/clearance-review';
import type { SmartSearchHit } from '../lib/smart-search-hit';

const fixture = JSON.parse(readFileSync('test/fixtures/smart-search-gb-truncated.json', 'utf8'));
const realHits: SmartSearchHit[] = fixture.results;

const hit = (over: Partial<SmartSearchHit> = {}): SmartSearchHit => ({
  score: 30, similarity: 'High', class_match: true, application_number: 'UK00000000001',
  classes: ['35'], status: 'Registered', mark: 'THING', registry: 'gb',
  application_date: '2020-01-01', owner: 'Someone Ltd', ...over,
} as SmartSearchHit);

describe('tiers', () => {
  it('are the three the report is built from', () => {
    expect(TIERS).toEqual(['highlight', 'appendix', 'exclude']);
  });

  // A hit the engine returned has been found. Defaulting it out of the report
  // would understate what the search saw; excluding is a decision someone makes.
  it('default to appendix, not exclude', () => {
    expect(DEFAULT_TIER).toBe('appendix');
    expect(tierOf({}, 'UK1')).toBe('appendix');
  });

  it('refuse a tier that is not one of the three', () => {
    expect(isTier('highlight')).toBe(true);
    expect(isTier('interesting')).toBe(false);
    expect(tierOf({ UK1: { applicationNumber: 'UK1', tier: 'nonsense' } }, 'UK1')).toBe('appendix');
  });

  it('key reviews by application number', () => {
    const m = reviewMap([{ applicationNumber: 'UK1', tier: 'highlight' }]);
    expect(tierOf(m, 'UK1')).toBe('highlight');
  });
});

describe('isLive', () => {
  it('treats the dead statuses as dead', () => {
    for (const s of ['Expired', 'Withdrawn', 'Abandoned', 'Refused', 'Cancelled', 'Surrendered']) {
      expect(isLive(hit({ status: s })), s).toBe(false);
    }
  });

  it('treats a pending application as live, not just a registration', () => {
    expect(isLive(hit({ status: 'Application published' }))).toBe(true);
    expect(isLive(hit({ status: 'Examination' }))).toBe(true);
  });

  // The bias is deliberate: hiding a live right is the failure that matters,
  // showing one row too many is not.
  it('treats an unrecognised status as live', () => {
    expect(isLive(hit({ status: 'Something New' }))).toBe(true);
    expect(isLive(hit({ status: '' }))).toBe(true);
  });
});

describe('isExactMatch', () => {
  it('is score 0, the engine\'s identical match', () => {
    expect(isExactMatch(hit({ score: 0 }))).toBe(true);
    expect(isExactMatch(hit({ score: 1 }))).toBe(false);
  });

  // Score 0 is the engine's identical BUCKET, not string equality. The real
  // LONDON capture scores "@LONDON" at 0 alongside "LONDON" and "London", so
  // the marker means "the engine considers this identical", which is the claim
  // a report should make — not "these characters match", which would be ours.
  it('marks the engine\'s identical bucket in the real LONDON capture', () => {
    const exact = realHits.filter(isExactMatch);
    expect(exact.length).toBeGreaterThan(0);
    expect(exact.map((h) => h.mark)).toContain('@LONDON');
    expect(exact.every((h) => (h.mark ?? '').toUpperCase().includes('LONDON'))).toBe(true);
    // Everything else in the capture scores above 0.
    expect(realHits.filter((h) => !isExactMatch(h)).every((h) => h.score > 0)).toBe(true);
  });
});

describe('quickSelect', () => {
  const hits = [
    hit({ application_number: 'A', score: 0, class_match: true, status: 'Registered' }),
    hit({ application_number: 'B', score: 25, class_match: false, status: 'Expired' }),
    hit({ application_number: 'C', score: 40, class_match: true, status: 'Registered' }),
  ];

  it('selects all and none', () => {
    expect(quickSelect(hits, 'all')).toEqual(['A', 'B', 'C']);
    expect(quickSelect(hits, 'none')).toEqual([]);
  });

  it('selects live only and class overlap', () => {
    expect(quickSelect(hits, 'live')).toEqual(['A', 'C']);
    expect(quickSelect(hits, 'overlap')).toEqual(['A', 'C']);
  });

  // Score is a distance: "under 30" means the closest, not the weakest.
  it('selects by score under a threshold, exclusive', () => {
    expect(quickSelect(hits, 'score', { scoreUnder: 30 })).toEqual(['A', 'B']);
    expect(quickSelect(hits, 'score', { scoreUnder: 25 })).toEqual(['A']);
    expect(quickSelect(hits, 'score', { scoreUnder: 0 })).toEqual([]);
  });

  it('selects nothing rather than everything when no threshold is given', () => {
    expect(quickSelect(hits, 'score')).toEqual([]);
  });
});

describe('tierUpdates', () => {
  it('produces one update per selected hit', () => {
    expect(tierUpdates(['A', 'B'], 'highlight', {})).toEqual([
      { applicationNumber: 'A', tier: 'highlight' },
      { applicationNumber: 'B', tier: 'highlight' },
    ]);
  });

  // A reviewedAt that moves without a decision behind it is a small lie in an
  // audit trail.
  it('writes nothing for a hit already at that tier', () => {
    const current = reviewMap([{ applicationNumber: 'A', tier: 'highlight' }]);
    expect(tierUpdates(['A'], 'highlight', current)).toEqual([]);
    expect(tierUpdates(['A'], 'exclude', current)).toEqual([{ applicationNumber: 'A', tier: 'exclude' }]);
  });

  it('deduplicates and ignores empty numbers', () => {
    expect(tierUpdates(['A', 'A', ''], 'exclude', {})).toEqual([{ applicationNumber: 'A', tier: 'exclude' }]);
  });
});

describe('matchesHistory', () => {
  const row: HistoryRow = {
    id: 'r1', term: 'LONDON', registry: 'gb', classes: ['35'], markRef: 'UK00002530115',
    runAt: '2026-08-31T09:00:00Z', runByName: 'Mark Kingsley-Williams', hitCount: 250,
    status: 'completed', reportState: 'none',
  };

  it('matches term, register, class and person', () => {
    expect(matchesHistory(row, 'london')).toBe(true);
    expect(matchesHistory(row, 'gb')).toBe(true);
    expect(matchesHistory(row, 'class 35')).toBe(true);
    expect(matchesHistory(row, 'kingsley')).toBe(true);
    expect(matchesHistory(row, 'UK00002530115')).toBe(true);
  });

  it('requires every token, so two words narrow rather than widen', () => {
    expect(matchesHistory(row, 'london gb')).toBe(true);
    expect(matchesHistory(row, 'london wo')).toBe(false);
  });

  it('matches everything on an empty filter', () => {
    expect(matchesHistory(row, '   ')).toBe(true);
  });
});

describe('recordAsResult', () => {
  const record: SavedRecordView = {
    id: 'r1', searchId: 'facade-1', term: 'LONDON', classes: ['35'], registry: 'gb',
    markRef: null, currencyDate: '2026-08-23', coverage: {}, resultCount: 250,
    totalAvailable: null, totalAtLeast: 250, upstreamCap: 250, truncated: true,
    status: 'completed', failureReason: null, hits: realHits, runAt: '2026-08-31T09:00:00Z',
  };

  it('renders a saved record through the same panel as a live run', () => {
    const r = recordAsResult(record);
    expect(r.status).toBe('completed');
    expect(r.results).toHaveLength(realHits.length);
    expect(r.currencyDate).toBe('2026-08-23');
    expect(r.truncated).toBe(true);
    expect(r.total_available).toBeNull();
    expect(r.total_at_least).toBe(250);
  });

  // An empty array would read as "searched, found nothing" — the opposite of
  // what a failure means.
  it('gives a failed record null results, never an empty list', () => {
    const r = recordAsResult({ ...record, status: 'failed', failureReason: 'worker timed out', hits: [] });
    expect(r.status).toBe('failed');
    expect(r.results).toBeNull();
    expect(r.failure_reason).toBe('worker timed out');
  });
});

describe('describeHit', () => {
  it('names a device mark rather than leaving a hole', () => {
    expect(describeHit(hit({ mark: '', application_number: 'UK9' }))).toContain('[no verbal element]');
  });
});

/**
 * The highlight tier's order (docs/clearance-workflow.md §4).
 *
 * Only that tier has one, because only it has a reader: the report's front
 * table argues its marks in the sequence a lawyer chose. The appendix is a
 * schedule and goes by score.
 */
describe('highlightOrder', () => {
  const hits = [
    hit({ application_number: 'A' }),
    hit({ application_number: 'B' }),
    hit({ application_number: 'C' }),
    hit({ application_number: 'D' }),
  ];
  const tiers = (m: Record<string, [string, number | null]>) =>
    reviewMap(Object.entries(m).map(([applicationNumber, [tier, position]]) => ({ applicationNumber, tier, position })));

  it('contains only the highlight tier, in the engine\'s order until placed', () => {
    const r = tiers({ A: ['highlight', null], B: ['appendix', null], C: ['highlight', null] });
    expect(highlightOrder(hits, r)).toEqual(['A', 'C']);
  });

  it('puts placed marks first, in their positions', () => {
    const r = tiers({ A: ['highlight', 2], C: ['highlight', 1] });
    expect(highlightOrder(hits, r)).toEqual(['C', 'A']);
  });

  // Promoting one mark must not scramble the rest into an arbitrary sequence.
  it('keeps the unplaced tail in the engine\'s order, after the placed', () => {
    const r = tiers({ D: ['highlight', 1], A: ['highlight', null], C: ['highlight', null] });
    expect(highlightOrder(hits, r)).toEqual(['D', 'A', 'C']);
  });

  it('ranks from 1, and nothing outside the tier has a rank', () => {
    const r = tiers({ A: ['highlight', null], C: ['highlight', null], B: ['appendix', null] });
    expect(highlightRank(hits, r, 'A')).toBe(1);
    expect(highlightRank(hits, r, 'C')).toBe(2);
    expect(highlightRank(hits, r, 'B')).toBeNull();
    expect(highlightRank(hits, r, 'D')).toBeNull();
  });
});

describe('reorderUpdates', () => {
  const hits = [
    hit({ application_number: 'A' }),
    hit({ application_number: 'B' }),
    hit({ application_number: 'C' }),
  ];
  const all = reviewMap([
    { applicationNumber: 'A', tier: 'highlight' },
    { applicationNumber: 'B', tier: 'highlight' },
    { applicationNumber: 'C', tier: 'highlight' },
  ]);

  // The whole tier is renumbered, not the pair that swapped: writing only the
  // pair would leave the rest holding whatever they had, and the stored order
  // would depend on the sequence of moves rather than on where things ended up.
  it('renumbers the whole tier from the top', () => {
    expect(reorderUpdates(hits, all, 'B', 'up')).toEqual([
      { applicationNumber: 'B', position: 1 },
      { applicationNumber: 'A', position: 2 },
      { applicationNumber: 'C', position: 3 },
    ]);
  });

  it('moves down as well as up', () => {
    expect(reorderUpdates(hits, all, 'A', 'down').map((u) => u.applicationNumber)).toEqual(['B', 'A', 'C']);
  });

  // Off the end is a no-op, not an error.
  it('writes nothing at either end', () => {
    expect(reorderUpdates(hits, all, 'A', 'up')).toEqual([]);
    expect(reorderUpdates(hits, all, 'C', 'down')).toEqual([]);
  });

  it('writes nothing for a mark outside the tier', () => {
    const r = reviewMap([{ applicationNumber: 'A', tier: 'appendix' }]);
    expect(reorderUpdates(hits, r, 'A', 'up')).toEqual([]);
  });

  it('round-trips: two moves that undo each other restore the order', () => {
    const first = reorderUpdates(hits, all, 'C', 'up');
    const after = reviewMap(first.map((u) => ({ ...u, tier: 'highlight' })));
    expect(highlightOrder(hits, after)).toEqual(['A', 'C', 'B']);
    const back = reorderUpdates(hits, after, 'C', 'down');
    expect(highlightOrder(hits, reviewMap(back.map((u) => ({ ...u, tier: 'highlight' }))))).toEqual(['A', 'B', 'C']);
  });
});

describe('clearOrderUpdates', () => {
  const hits = [hit({ application_number: 'A' }), hit({ application_number: 'B' })];

  it('nulls every position that was set', () => {
    const r = reviewMap([
      { applicationNumber: 'A', tier: 'highlight', position: 1 },
      { applicationNumber: 'B', tier: 'highlight', position: 2 },
    ]);
    expect(clearOrderUpdates(hits, r)).toEqual([
      { applicationNumber: 'A', position: null },
      { applicationNumber: 'B', position: null },
    ]);
  });

  // Resetting an order nobody chose should not touch every row's reviewedAt to
  // say nothing changed.
  it('writes nothing when no order was chosen', () => {
    const r = reviewMap([{ applicationNumber: 'A', tier: 'highlight' }]);
    expect(clearOrderUpdates(hits, r)).toEqual([]);
  });
});
