/**
 * The link from a mark to a clearance search, and the reading of it.
 *
 * Both ends in one module, as lib/deep-links.ts does for the Slack landings:
 * the detail panel writes these params and the clearance page reads them, and a
 * rename on one side without the other is how a prefilled search quietly stops
 * prefilling. Pure — no window, no env, no clock.
 *
 * Relative on purpose. This link is followed inside the app, so it needs no
 * base URL; the absolute form a watch notice carries to AiLA Core is
 * resultsDeepLink() in lib/smart-search-notice.ts, and that one is by search id
 * because a notice points at a result, not at a query to re-run.
 */
import { normaliseClasses } from './smart-search-classes';

export const TERM_PARAM = 'term';
export const CLASSES_PARAM = 'classes';
export const MARK_REF_PARAM = 'mark_ref';
export const SEARCH_PARAM = 'search';

export type ClearanceArrival = {
  /** An id to reopen. Takes precedence: a result beats a query to re-run. */
  searchId: string | null;
  term: string;
  classes: string[];
  markRef: string | null;
};

/** The mark fields a clearance search needs. */
export type ClearanceSubject = {
  mark_text?: string | null;
  application_number?: string | null;
  good_and_services?: Array<{ search_class: { number: number } }> | null;
};

/**
 * Where "run a clearance search" on a mark goes.
 *
 * The term is the mark text and the classes are the mark's own — the search a
 * lawyer would run by hand, prefilled rather than assumed: the page shows both
 * and either can be changed before running.
 *
 * A device mark with no verbal element yields an empty term, so the link lands
 * on an empty form rather than searching for "". There is nothing to text-match
 * on, and inventing a term from the application number would search for a
 * number no one registered.
 */
export function clearanceHref(mark: ClearanceSubject): string {
  const term = (mark.mark_text ?? '').trim();
  const classes = normaliseClasses((mark.good_and_services ?? []).map((g) => g?.search_class?.number));
  const params = new URLSearchParams();
  if (term) params.set(TERM_PARAM, term);
  if (classes.length) params.set(CLASSES_PARAM, classes.join(','));
  if (mark.application_number) params.set(MARK_REF_PARAM, mark.application_number);
  const qs = params.toString();
  return qs ? `/clearance?${qs}` : '/clearance';
}

/** What an arrival at /clearance carries. Accepts a raw query string or params. */
export function clearanceArrival(search: string | URLSearchParams): ClearanceArrival {
  let params: URLSearchParams;
  try {
    params = typeof search === 'string' ? new URLSearchParams(search) : search;
  } catch {
    return { searchId: null, term: '', classes: [], markRef: null };
  }
  return {
    searchId: params.get(SEARCH_PARAM) || null,
    term: (params.get(TERM_PARAM) ?? '').trim(),
    classes: normaliseClasses(params.get(CLASSES_PARAM) ?? ''),
    markRef: params.get(MARK_REF_PARAM) || null,
  };
}
