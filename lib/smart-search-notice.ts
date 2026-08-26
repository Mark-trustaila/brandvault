/**
 * What a completed Smart Search tells AiLA Core — the Unit C hook, built now,
 * dark until Core exists.
 *
 * Contract: smart-search-facade-contract-v1.md §7. A *watch* search (recurring,
 * tied to a mark) emits `watch.notice`. A one-shot clearance search does not:
 * it is a user standing at the screen waiting for an answer, and the answer is
 * the screen. Emitting one would put a matter in someone's AiLA queue for a
 * question already answered.
 *
 * The split is enforced here, in one pure function, rather than at each call
 * site. `noticeFor` returns null for a clearance search, so the only way to
 * emit from a clearance run is to lie about its kind.
 *
 * Dark, precisely: lib/ailaCore.ts is a no-op returning `unconfigured` while
 * AILA_CORE_URL / AILA_CORE_APP_KEY are unset, which they are. Nothing here
 * needs a feature flag, and nothing needs removing when Core lands — Mark sets
 * two env vars and the same code delivers.
 */
import { emitWatchNotice, matterTitle, type EmitResult } from './ailaCore';
import { APP_BASE_URL } from './slack';
import type { SmartSearchHit, SmartSearchResult } from './smart-search';

/** Why a search was run. Only `watch` reaches Core. */
export type SearchKind = 'clearance' | 'watch';

export type WatchNoticePlan = {
  markRef: string;
  noticeRef: string;
  noticeSummary: string;
  deepLink: string;
  title: string;
  importance?: number;
};

/** Where a notice lands: the results view, on this search. */
export function resultsDeepLink(searchId: string, base: string = APP_BASE_URL): string {
  return `${base}/clearance?search=${encodeURIComponent(searchId)}`;
}

const rank = (h: SmartSearchHit): string => (h.similarity ?? '').trim().toLowerCase();

/**
 * The counts a reader acts on.
 *
 * The similarity verdict is the engine's, so it is counted as given rather than
 * re-derived from `score` — the thresholds behind those words are LawPanel's
 * and are not ours to reinvent (§2.3). An unrecognised verdict still counts
 * toward `total`, so a vocabulary we have not seen cannot make hits vanish.
 */
export function tallyHits(hits: SmartSearchHit[]): { veryHigh: number; high: number; classMatches: number; total: number } {
  let veryHigh = 0, high = 0, classMatches = 0;
  for (const h of hits) {
    const r = rank(h);
    if (r === 'very high') veryHigh++;
    else if (r === 'high') high++;
    if (h.class_match) classMatches++;
  }
  return { veryHigh, high, classMatches, total: hits.length };
}

/**
 * One line a person can read in a feed without opening anything.
 *
 * "3 very-high hits for BLOC" is the contract's own example (§7) and the shape
 * to keep: a number, its severity, and the mark. Where there is nothing severe
 * the line says so plainly rather than dressing a clean result up as a finding —
 * a watch that reports "0 hits" every week is the only way its reader learns to
 * trust the week it reports 3.
 */
export function noticeSummary(term: string, hits: SmartSearchHit[]): string {
  const t = tallyHits(hits);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (t.veryHigh > 0) return `${plural(t.veryHigh, 'very-high hit')} for ${term}`;
  if (t.high > 0) return `${plural(t.high, 'high hit')} for ${term}`;
  if (t.total > 0) return `${plural(t.total, 'hit')} for ${term}, none rated high`;
  return `No hits for ${term}`;
}

/**
 * Stakes, 1-5, for Core's matter envelope (contract §2.3): a stable judgement,
 * not urgency. A very-high hit in an overlapping class is the case a lawyer
 * wants to see first; a clean run is the floor.
 */
export function noticeImportance(hits: SmartSearchHit[]): number {
  const t = tallyHits(hits);
  const overlapping = hits.some((h) => h.class_match && rank(h) === 'very high');
  if (t.veryHigh > 0) return overlapping ? 5 : 4;
  if (t.high > 0) return 3;
  if (t.total > 0) return 2;
  return 1;
}

/**
 * The notice a completed search warrants, or null when it warrants none.
 *
 * Null for: a clearance search (shown inline, §7), a search still running, and
 * a search that failed. A failed watch is a real event and worth surfacing, but
 * `watch.notice` says something was found — sending one carrying a failure
 * would put "0 hits" in front of a reader when the truth is "we did not look".
 * Failure surfaces in the UI as its own state (§3.3); routing it to Core is a
 * separate event type and a v1.x decision, not something to fake here.
 *
 * A watch with no anchoring mark also yields null: `watch.notice` is anchored on
 * a mark ref (§3 of the Core contract), and inventing one from the search term
 * is the mark-text matching lib/watch-notices.ts refuses for the same reason.
 */
export function noticeFor(
  result: SmartSearchResult,
  kind: SearchKind,
  opts: { markRef?: string | null; markText?: string | null; base?: string } = {},
): WatchNoticePlan | null {
  if (kind !== 'watch') return null;
  if (result.status !== 'completed' || !result.results) return null;
  const markRef = (opts.markRef ?? result.mark_ref ?? '').trim();
  if (!markRef) return null;

  const term = result.term || opts.markText || markRef;
  return {
    markRef,
    // Concurrent watches on one mark must not collapse into each other in the
    // feed; the search id is the thing that distinguishes two runs.
    noticeRef: result.search_id,
    noticeSummary: noticeSummary(term, result.results),
    deepLink: resultsDeepLink(result.search_id, opts.base),
    title: matterTitle('Watch', opts.markText ?? term, markRef),
    importance: noticeImportance(result.results),
  };
}

/**
 * Emit, if there is anything to emit. Returns null when `noticeFor` says no,
 * so a caller can report "nothing to send" distinctly from "sent" and from
 * "Core is not configured" — the three are different and the backfill that
 * reported 25 delivered against a 401 is why that distinction is kept.
 */
export async function emitIfWatch(
  companyId: string,
  result: SmartSearchResult,
  kind: SearchKind,
  opts: { markRef?: string | null; markText?: string | null; base?: string } = {},
): Promise<EmitResult | null> {
  const plan = noticeFor(result, kind, opts);
  if (!plan) return null;
  return emitWatchNotice({ companyId, ...plan });
}
