/**
 * Where a Slack link lands you in the app.
 *
 * Three landings, one per kind of message:
 *
 *   mark-specific replies   →  ?q=<text>          search-filtered dashboard
 *   summary replies         →  ?bree=1            dashboard, Bree panel open
 *   notification alerts     →  ?notification=<id> panel open, scrolled to item
 *
 * The third already existed (`notificationLink` in lib/notifications.ts) and is
 * unchanged. The first two are added here.
 *
 * `?bree=1` rather than reusing the digest's link: the digest lands panel-open
 * because it writes a `Notification` row and links to it. A slash command is a
 * read-only question, so minting a notification row per `/bree renewals` would
 * put a thread in the panel for every question anyone asks. This param reaches
 * the same landing by setting the `breeOpen` state the panel already has,
 * rather than inventing state or writing a row.
 *
 * Parsing lives here too, so the writer and the reader of a link cannot drift:
 * one module owns both ends of each param.
 *
 * Pure: no clock, no I/O, no `window`. Callers pass the query string.
 */
import { APP_BASE_URL } from './slack';

export const SEARCH_PARAM = 'q';
export const PANEL_PARAM = 'bree';

/**
 * Mark-specific replies land on the search-filtered dashboard.
 *
 * The text is the query the user asked about, not a resolved mark name, so the
 * landing reproduces exactly what typing that text into the search bar gives.
 * The dashboard search is a substring match across mark text, numbers, registry,
 * status and agent, so "TOPSHOP" legitimately lands on TOPSHOP and TOPSHOP
 * UNIQUE together. Arrival is company-scoped like every other route, and a
 * query matching nothing shows the search's ordinary empty state.
 */
export function dashboardSearchLink(query: string, base: string = APP_BASE_URL): string {
  return `${base}/?${SEARCH_PARAM}=${encodeURIComponent(query)}`;
}

/** Summary replies land on the dashboard with the Bree panel open. */
export function breePanelLink(base: string = APP_BASE_URL): string {
  return `${base}/?${PANEL_PARAM}=1`;
}

/**
 * The search text an arrival carries, or '' when there is none.
 * Accepts a raw query string with or without the leading '?'.
 */
export function searchQueryFromUrl(search: string): string {
  try {
    return (new URLSearchParams(search).get(SEARCH_PARAM) ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Whether an arrival asks for the Bree panel.
 *
 * Present-and-not-negated, so `?bree=1` and a bare `?bree` both open it while
 * `?bree=0` does not. A link someone edited by hand should not surprise them.
 */
export function panelOpenFromUrl(search: string): boolean {
  try {
    const v = new URLSearchParams(search).get(PANEL_PARAM);
    if (v === null) return false;
    return !['0', 'false', 'no'].includes(v.trim().toLowerCase());
  } catch {
    return false;
  }
}
