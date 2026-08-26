/**
 * When to poll a Smart Search again, and when to stop.
 *
 * Pure and env-free, so the browser can import it without pulling in the
 * server-only facade client (lib/smart-search.ts holds keys and must never
 * reach a bundle).
 *
 * Policy in one place because giving up is a decision with a wrong answer in
 * both directions: stop too early and a slow-but-successful search is reported
 * as a timeout, keep going forever and a wedged search spins a browser tab
 * until someone closes it. The searcher worker has run a query for 27 hours
 * without finishing, so "forever" is not hypothetical here.
 */

/** First polls are quick, then ease off — most searches settle in seconds. */
const FIRST_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 4_000;

/** Total time before the client stops asking and says so. */
export const POLL_CAP_MS = 90_000;

/**
 * How long to wait before poll number `attempt` (1-based).
 * Linear step to the ceiling: no thundering retry, no long first wait.
 */
export function pollDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(FIRST_INTERVAL_MS * n, MAX_INTERVAL_MS);
}

/**
 * Keep polling? Only while the search is running AND the cap has not passed.
 *
 * A settled search — completed or failed — always stops the loop, including a
 * failure: the answer has arrived and it is "we did not look", which the panel
 * renders. Polling on would turn a stated failure into a spinner.
 */
export function shouldKeepPolling(status: string, elapsedMs: number): boolean {
  if (status !== 'running') return false;
  return elapsedMs < POLL_CAP_MS;
}

/**
 * What to tell someone when the cap is reached.
 *
 * Not "no results" and not an error — the search may still be running at the
 * register. Say exactly that, and offer the id, so a slow result is not read as
 * a clear register.
 */
export function timedOutMessage(searchId: string): string {
  return `The register has not answered in ${Math.round(POLL_CAP_MS / 1000)} seconds. The search may still be running — nothing here says the term is clear. Reference ${searchId}.`;
}
