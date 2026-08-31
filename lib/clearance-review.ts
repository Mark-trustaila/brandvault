/**
 * The lawyer's judgement on a clearance result: tiers, selection, and the
 * history filter. Pure — no Prisma, no env, no clock — so the browser and the
 * routes share one definition and the rules can be pinned by tests.
 *
 * Two ideas are deliberately kept apart. Selection is transient: a tick exists
 * to apply a tier to several rows at once and is forgotten immediately. The
 * tier is what persists. Storing the ticks would invite a reader to mistake
 * "what I had selected when I stopped" for "what I decided".
 */
import { hitMarkText, hitClasses, type SmartSearchHit } from './smart-search-hit';

/**
 * highlight — marks of interest; the report's front table, in saved order.
 * appendix  — everything else found; the schedule at the back.
 * exclude   — seen and dismissed; stays in the snapshot, absent from reports.
 *
 * Appendix is the default because a hit the engine returned has been found,
 * and a report that omits it by default would understate what the search saw.
 * Excluding is a decision someone makes, not a state something falls into.
 */
export const TIERS = ['highlight', 'appendix', 'exclude'] as const;
export type Tier = (typeof TIERS)[number];
export const DEFAULT_TIER: Tier = 'appendix';

export const TIER_LABEL: Record<Tier, string> = {
  highlight: 'Of interest',
  appendix: 'Appendix',
  exclude: 'Excluded',
};

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

export type HitReview = { applicationNumber: string; tier: string; note?: string | null; position?: number | null };

/** Reviews keyed by application number, for O(1) lookup while rendering. */
export function reviewMap(reviews: HitReview[]): Record<string, HitReview> {
  const out: Record<string, HitReview> = {};
  for (const r of reviews) out[r.applicationNumber] = r;
  return out;
}

/** The tier a hit currently carries. Unreviewed hits are appendix. */
export function tierOf(reviews: Record<string, HitReview>, applicationNumber: string): Tier {
  const t = reviews[applicationNumber]?.tier;
  return isTier(t) ? t : DEFAULT_TIER;
}

/**
 * Statuses that mean the right is gone. Everything else — including anything
 * unrecognised — counts as live.
 *
 * The bias is deliberate. Treating an unknown status as dead would quietly drop
 * a live right out of a "live only" selection, and a clearance search that
 * hides a live mark is the failure that matters. Treating it as live at worst
 * shows one row too many, which a reader can see and dismiss.
 */
const DEAD_STATUSES = new Set([
  'expired', 'abandoned', 'withdrawn', 'refused', 'cancelled', 'canceled',
  'surrendered', 'dead', 'lapsed', 'revoked', 'invalid',
]);

export function isLive(hit: SmartSearchHit): boolean {
  return !DEAD_STATUSES.has((hit.status ?? '').trim().toLowerCase());
}

/**
 * An identical mark. Score 0 is the engine's exact match — the fact a clearance
 * report opens by stating one way or the other, so it is marked in the table
 * rather than left to be spotted.
 */
export function isExactMatch(hit: SmartSearchHit): boolean {
  return hit.score === 0;
}

export type QuickSelectKind = 'all' | 'live' | 'overlap' | 'score' | 'none';

/**
 * Application numbers a quick-select button ticks. Never mutates, never
 * persists — the caller sets the tick state and the ticks die with the view.
 *
 * `score` uses "under", exclusive, because score is a distance: lower is
 * closer, and 0 is identical. "Score under 20" means "the twenty closest
 * points of difference", not "the weakest matches".
 */
export function quickSelect(
  hits: SmartSearchHit[],
  kind: QuickSelectKind,
  opts: { scoreUnder?: number } = {},
): string[] {
  const nums = (list: SmartSearchHit[]) => list.map((h) => h.application_number).filter(Boolean);
  switch (kind) {
    case 'all': return nums(hits);
    case 'none': return [];
    case 'live': return nums(hits.filter(isLive));
    case 'overlap': return nums(hits.filter((h) => Boolean(h.class_match)));
    case 'score': {
      const limit = opts.scoreUnder;
      if (typeof limit !== 'number' || !Number.isFinite(limit)) return [];
      return nums(hits.filter((h) => h.score < limit));
    }
  }
}

/**
 * The updates a bulk tier action produces.
 *
 * Only rows whose tier actually changes are returned, so applying "appendix" to
 * a selection that is already appendix writes nothing and leaves reviewedAt
 * alone. A timestamp that moves without a decision behind it is a small lie in
 * an audit trail.
 */
export function tierUpdates(
  selected: string[],
  tier: Tier,
  current: Record<string, HitReview>,
): Array<{ applicationNumber: string; tier: Tier }> {
  const seen = new Set<string>();
  const out: Array<{ applicationNumber: string; tier: Tier }> = [];
  for (const appNo of selected) {
    if (!appNo || seen.has(appNo)) continue;
    seen.add(appNo);
    if (tierOf(current, appNo) === tier) continue;
    out.push({ applicationNumber: appNo, tier });
  }
  return out;
}

/** One row of the Clearances table, as the list route returns it. */
export type HistoryRow = {
  id: string;
  term: string;
  registry: string;
  classes: string[];
  markRef: string | null;
  runAt: string;
  runByName: string | null;
  hitCount: number;
  status: string;
  reportState: 'none' | 'draft' | 'issued';
};

/**
 * The table's text filter: term, class, register and who ran it, in one box.
 *
 * Matches the fields a person would type from memory. Not the hits — a filter
 * that searched inside every snapshot would make "ASOS" return every search
 * that happened to turn up an ASOS mark, which is not what someone looking for
 * their own search means.
 */
export function matchesHistory(row: HistoryRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    row.term,
    row.registry,
    row.markRef ?? '',
    row.runByName ?? '',
    ...row.classes,
    ...row.classes.map((c) => `class ${c}`),
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

/** A short, honest description of a hit for a note field or a log line. */
export function describeHit(hit: SmartSearchHit): string {
  const mark = hitMarkText(hit) || '[no verbal element]';
  const classes = hitClasses(hit);
  return `${mark} (${hit.application_number})${classes.length ? ` · class ${classes.join(', ')}` : ''}`;
}

/** The stored record, as the read route returns it. */
export type SavedRecordView = {
  id: string;
  searchId: string;
  term: string;
  classes: string[];
  registry: string;
  markRef: string | null;
  currencyDate: string | null;
  coverage?: unknown;
  resultCount: number | null;
  totalAvailable: number | null;
  totalAtLeast: number | null;
  upstreamCap: number | null;
  truncated: boolean;
  status: string;
  failureReason: string | null;
  hits: SmartSearchHit[];
  runAt: string;
};

/**
 * A saved record in the shape the results panel already renders.
 *
 * One panel for a live run and for a record reopened months later, so the two
 * cannot drift into showing the same search differently. The record is the
 * source of truth either way — even a fresh run is read back from the database
 * before it is displayed, so what the lawyer reviews is what was stored.
 */
export function recordAsResult(record: SavedRecordView): {
  search_id: string; status: 'completed' | 'failed'; term: string; classes: string[];
  registry: string; currencyDate: string; coverage: any; results: SmartSearchHit[] | null;
  failure_reason: string | null; mark_ref: string | null;
  result_count: number | null; total_available: number | null; total_at_least: number | null;
  cap: number | null; upstream_cap: number | null; truncated: boolean;
} {
  const status = record.status === 'failed' ? 'failed' : 'completed';
  return {
    search_id: record.searchId,
    status,
    term: record.term,
    classes: record.classes ?? [],
    registry: record.registry,
    currencyDate: record.currencyDate ?? '',
    coverage: record.coverage,
    // A failed search has no results, and an empty array would read as
    // "searched, found nothing" — the opposite of what failure means.
    results: status === 'failed' ? null : record.hits ?? [],
    failure_reason: record.failureReason,
    mark_ref: record.markRef,
    result_count: record.resultCount,
    total_available: record.totalAvailable,
    total_at_least: record.totalAtLeast,
    cap: null,
    upstream_cap: record.upstreamCap,
    truncated: record.truncated,
  };
}
