/**
 * Watch-notice anchoring: which customer mark a third-party filing notice
 * attaches to, and the class overlap the comparison view highlights.
 *
 * The anchor is ALWAYS the application number the notice cites. Matching by
 * mark text is not implemented and must not be: a notice about "Assos" naming
 * the recipient's "ASOS" right would attach itself to the wrong record, or to
 * several, on a string-similarity judgement no one asked for. A cited number
 * that matches nothing in the portfolio produces no WatchNotice at all. It
 * routes alert-only to the inbox with a "no matching right" note.
 *
 * Pure. No DB, no scoring, no ranking.
 */
import type { WatchNoticeDetails } from './email-types';

/** The portfolio shape this module needs to resolve an anchor. */
export type PortfolioMark = {
  id: string;
  applicationNumber: string | null;
  markText: string;
};

export type AnchoredNotice = {
  trademarkId: string;
  citedReference: string;
  thirdPartyMarkText: string;
  thirdPartyApplicationNumber: string;
  thirdPartyClasses: number[];
  filingDate: Date | null;
  oppositionDeadline: Date | null;
};

export type AnchorResult = {
  /** One per cited mark that resolves. A notice citing two rights yields two. */
  anchored: AnchoredNotice[];
  /** Cited references that match nothing in the portfolio. */
  unmatchedReferences: string[];
  /** Why no notice was created, when none was. */
  skippedReason: 'no-cited-references' | 'no-third-party-application-number' | 'no-third-party-mark-text' | null;
};

/**
 * Registry numbers are quoted with varying spacing and case across letters and
 * forwarding chains. Compare on a normalised form, store the portfolio's own.
 */
export const normaliseRef = (ref: string): string => ref.replace(/[\s/-]/g, '').toUpperCase();

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function anchorWatchNotice(
  details: WatchNoticeDetails | null | undefined,
  portfolio: PortfolioMark[]
): AnchorResult {
  const empty = (reason: AnchorResult['skippedReason']): AnchorResult => ({
    anchored: [],
    unmatchedReferences: [],
    skippedReason: reason,
  });

  if (!details) return empty('no-cited-references');

  // A notice with no identifiable third-party application is not something the
  // comparison view can render, so it stays alert-only.
  if (!details.thirdPartyApplicationNumber) return empty('no-third-party-application-number');
  if (!details.thirdPartyMarkText) return empty('no-third-party-mark-text');

  const cited = details.citedMarkReferences ?? [];
  if (cited.length === 0) return empty('no-cited-references');

  const byRef = new Map<string, PortfolioMark>();
  for (const m of portfolio) {
    if (m.applicationNumber) byRef.set(normaliseRef(m.applicationNumber), m);
  }

  const anchored: AnchoredNotice[] = [];
  const unmatchedReferences: string[] = [];
  const seen = new Set<string>();

  for (const ref of cited) {
    const mark = byRef.get(normaliseRef(ref));
    if (!mark) {
      unmatchedReferences.push(ref);
      continue;
    }
    // The same right cited twice in one letter is still one notice.
    if (seen.has(mark.id)) continue;
    seen.add(mark.id);

    anchored.push({
      trademarkId: mark.id,
      citedReference: ref,
      thirdPartyMarkText: details.thirdPartyMarkText,
      thirdPartyApplicationNumber: details.thirdPartyApplicationNumber,
      thirdPartyClasses: Array.from(new Set(details.thirdPartyClasses ?? [])).sort((a, b) => a - b),
      filingDate: parseDate(details.filingDate),
      oppositionDeadline: parseDate(details.oppositionDeadline),
    });
  }

  return { anchored, unmatchedReferences, skippedReason: null };
}

/**
 * Classes present on both sides. Set intersection over class numbers and
 * nothing else: no similarity, no relatedness, no coordinated-class expansion.
 * Counsel judges what an overlap means.
 */
export function overlappingClasses(ourClasses: number[], theirClasses: number[]): number[] {
  const theirs = new Set(theirClasses);
  return Array.from(new Set(ourClasses)).filter((c) => theirs.has(c)).sort((a, b) => a - b);
}

/**
 * The one sentence the comparison view states about the overlap.
 *
 * Pure and tested here rather than inside the component: this is the only
 * assertion the screen makes, and it must never drift into characterising the
 * overlap as similarity or risk. It reports class membership and stops.
 */
export function overlapSentence(overlap: number[]): string {
  if (overlap.length === 0) return 'The two filings share no class.';
  return `Both marks are filed in class${overlap.length === 1 ? '' : 'es'} ${overlap.join(', ')}.`;
}

/** Countdown label for the opposition window. Null when no deadline is stated. */
export function oppositionLabel(days: number | null): string | null {
  if (days === null) return null;
  return days >= 0 ? `${days} days remaining` : `closed ${Math.abs(days)} days ago`;
}

/** Whole days from now to the opposition deadline. Null when not stated. */
export function daysToOpposition(deadline: Date | null, now: Date): number | null {
  if (!deadline) return null;
  return Math.floor((deadline.getTime() - now.getTime()) / 86_400_000);
}
