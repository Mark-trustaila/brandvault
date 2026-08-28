/**
 * Smart Search facade client (server-side ONLY).
 * ==============================================
 * Thin client for the Smart Search capability on the facade, which fronts
 * LawPanel's search engine. Contract: docs/smart-search-facade-contract-v1.md
 * (frozen v1, 8 Aug 2026). We build against §3 and nothing upstream of it:
 * BrandVault never calls api-live.lawpanel.com and never holds a LawPanel key.
 *
 * Secrets, as for the registry facade — never shipped to the browser:
 *   - SMART_SEARCH_FACADE_URL     → base, falls back to REGISTRY_FACADE_URL
 *   - SMART_SEARCH_FACADE_KEY     → x-brandvault-key, falls back to REGISTRY_FACADE_KEY
 *   - SMART_SEARCH_FACADE_FN_KEY  → x-functions-key,  falls back to REGISTRY_FACADE_FN_KEY
 *
 * The fallbacks exist because §3 puts Smart Search on the same host and the
 * same auth scheme as the registry reads. If Unit A deploys it beside the
 * existing capability, the three REGISTRY_FACADE_* vars already in Vercel are
 * enough and nothing new is set. If it lands on its own host, the three
 * SMART_SEARCH_* vars override. Mark sets env; this module only reads it.
 *
 * Running against the mock is a URL, not a mode: point SMART_SEARCH_FACADE_URL
 * at `npm run mock:smart-search` and the client is unchanged. There is no mock
 * branch in here to strip out when the live URL arrives.
 *
 * Async is the facade's problem, not ours: submit returns a search id, we poll
 * the facade (never a LawPanel job), and a request thread never blocks on an
 * external job. That is §3.2's recommendation and this client assumes it.
 */

// Class normalisation lives in its own env-free module so the browser can
// share it without pulling this one (and its keys) into a bundle. Re-exported
// so a server-side caller needs a single import.
import { normaliseClasses } from './smart-search-classes';
export { normaliseClasses };
import type { SmartSearchHit } from './smart-search-hit';

/** §3.2 status. `failed` is a settled outcome, not an exception — see §3.3. */
export type SmartSearchStatus = 'running' | 'completed' | 'failed';

// The hit shape and its two accessors live in their own env-free module, so the
// browser can read a hit without pulling this one (and its keys) into a bundle.
// Re-exported so a server-side caller needs a single import. The facade
// normalises further than §3.2 spells out; lib/smart-search-hit.ts explains
// what and why, and absorbs the difference.
export type { SmartSearchHit, RawSmartSearchHit } from './smart-search-hit';
export { hitMarkText, hitClasses, hitClassesLabel } from './smart-search-hit';

/** Known-partiality caveats, machine-readable, as the registry facade sends. */
export interface Coverage {
  [key: string]: { partial: boolean; approxPct?: number; note: string } | undefined;
}

/** §3.2 poll response. */
export interface SmartSearchResult {
  search_id: string;
  status: SmartSearchStatus;
  term: string;
  classes: string[];
  registry: string;
  currencyDate: string;
  coverage?: Coverage;
  results: SmartSearchHit[] | null;
  failure_reason: string | null;
  mark_ref?: string | null;
  /**
   * Cap discipline, present on a completed search. The facade truncates rather
   * than refusing — a clearance search loses less from a missing tail than from
   * no answer at all — and says plainly what it did.
   *
   * `truncated` is the one a reader must never miss: a capped list that reads as
   * a complete search of the register is a false clear, and a false clear is the
   * one wrong answer in clearance that nobody catches.
   */
  result_count: number | null;
  /**
   * The true number of matches, when it is knowable. NULL when upstream itself
   * capped the search: LawPanel returns at most `upstream_cap` hits and does not
   * report how many it had, so the total genuinely is not known and must not be
   * guessed at. `result_count` is not a total and is never to be rendered as
   * one when this is null.
   */
  total_available: number | null;
  /** The floor, when the total is unknown: at least this many matches exist. */
  total_at_least: number | null;
  /** What the register's own search will return at most. Upstream's ceiling. */
  upstream_cap: number | null;
  /** The facade's own cap, which is a separate ceiling from upstream's. */
  cap: number | null;
  truncated: boolean;
}

/** §3.1 submit response. */
export interface SmartSearchSubmission {
  search_id: string;
  status: SmartSearchStatus;
}

export interface SmartSearchHealth {
  reachable: boolean;
  currencyDate: string | null;
  coverage?: Coverage;
}

/**
 * A transport or facade-level failure: the facade could not be reached, or
 * answered with something other than a result.
 *
 * Distinct from `status: "failed"`, which is a search that ran and did not
 * succeed. That is data, carried in SmartSearchResult, and the UI renders it.
 * This is an error. Conflating the two is exactly what §3.3 forbids.
 */
export class SmartSearchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly body?: any,
  ) {
    super(message);
    this.name = 'SmartSearchError';
  }
}


const DEFAULT_TIMEOUT_MS = 25_000;

function config() {
  const url = process.env.SMART_SEARCH_FACADE_URL || process.env.REGISTRY_FACADE_URL;
  const key = process.env.SMART_SEARCH_FACADE_KEY || process.env.REGISTRY_FACADE_KEY;
  const fnKey = process.env.SMART_SEARCH_FACADE_FN_KEY || process.env.REGISTRY_FACADE_FN_KEY;
  if (!url) {
    throw new SmartSearchError('CONFIG', 'SMART_SEARCH_FACADE_URL (or REGISTRY_FACADE_URL) is not set', 0);
  }
  return { url: url.replace(/\/$/, ''), key: key ?? '', fnKey: fnKey ?? '' };
}

/** True when a facade base URL is configured, so a caller can hide the feature. */
export function isConfigured(): boolean {
  return Boolean(process.env.SMART_SEARCH_FACADE_URL || process.env.REGISTRY_FACADE_URL);
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  { anonymous = false }: { anonymous?: boolean } = {},
): Promise<{ status: number; json: any }> {
  const { url, key, fnKey } = config();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!anonymous) {
    headers['x-brandvault-key'] = key;
    headers['x-functions-key'] = fnKey;
  }
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (e: any) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw new SmartSearchError(
      timedOut ? 'TIMEOUT' : 'NETWORK',
      `smart-search ${method} ${path}: ${e?.message ?? e}`,
      0,
    );
  }
  let json: any = null;
  try { json = await res.json(); } catch { /* leave null */ }
  return { status: res.status, json };
}

function fail(status: number, json: any): never {
  throw new SmartSearchError(
    json?.error?.code ?? `HTTP_${status}`,
    json?.error?.message ?? `HTTP ${status}`,
    status,
    json,
  );
}

/**
 * POST /smart-search/{registry}/search — §3.1. Submits and returns the id to
 * poll. `markRef` is provenance only: which BrandVault mark the search was run
 * from. The facade echoes it back on the poll, which is how a result knows the
 * mark it belongs to without BrandVault holding state between the two calls.
 */
export async function submitSearch(
  args: { term: string; classes?: unknown; markRef?: string | null },
  registry = 'gb',
): Promise<SmartSearchSubmission> {
  const term = (args.term ?? '').trim();
  if (!term) throw new SmartSearchError('BAD_REQUEST', 'term is required', 0);
  const body: Record<string, unknown> = { term, classes: normaliseClasses(args.classes) };
  if (args.markRef) body.mark_ref = args.markRef;
  const { status, json } = await call('POST', `/smart-search/${registry}/search`, body);
  if (status !== 200 && status !== 201 && status !== 202) fail(status, json);
  if (!json?.search_id) fail(status, json ?? { error: { code: 'BAD_RESPONSE', message: 'no search_id' } });
  return json as SmartSearchSubmission;
}

/**
 * GET /smart-search/{search_id} — §3.2. One poll.
 *
 * A `failed` search comes back as a result, not a throw: the caller renders the
 * reason. Only the transport failing throws.
 */
export async function getSearch(searchId: string): Promise<SmartSearchResult> {
  const { status, json } = await call('GET', `/smart-search/${encodeURIComponent(searchId)}`);
  if (status === 404) fail(404, json ?? { error: { code: 'SEARCH_NOT_FOUND', message: 'unknown search id' } });
  if (status !== 200) fail(status, json);
  return normaliseResult(searchId, json);
}

/**
 * Fill the gaps a facade response may leave, so every caller sees one shape.
 *
 * An unrecognised status is treated as `running` rather than guessed at:
 * §6 q1 leaves the exact terminal strings to Unit A's first live smoke, and a
 * client that renders an unknown string as "completed with no hits" would
 * report an empty register where there was a search still in flight. Running is
 * the honest reading — the UI keeps polling and the cap ends it.
 */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function normaliseResult(searchId: string, json: any): SmartSearchResult {
  const raw = String(json?.status ?? '').toLowerCase();
  const status: SmartSearchStatus =
    raw === 'completed' || raw === 'failed' ? raw : 'running';
  return {
    search_id: json?.search_id ?? searchId,
    status,
    term: json?.term ?? '',
    classes: Array.isArray(json?.classes) ? json.classes.map(String) : normaliseClasses(json?.classes),
    registry: json?.registry ?? '',
    currencyDate: json?.currencyDate ?? '',
    coverage: json?.coverage,
    results: status === 'completed' ? (Array.isArray(json?.results) ? json.results : []) : null,
    failure_reason: json?.failure_reason ?? null,
    mark_ref: json?.mark_ref ?? null,
    result_count: num(json?.result_count),
    total_available: num(json?.total_available),
    total_at_least: num(json?.total_at_least),
    upstream_cap: num(json?.upstream_cap),
    cap: num(json?.cap),
    // Strictly true. A facade that stops sending the field, or sends something
    // truthy-but-not-true, must not silently start claiming a complete search.
    truncated: json?.truncated === true,
  };
}

/** GET /smart-search/health — §3.3, anonymous. Reachability + currency. */
export async function health(): Promise<SmartSearchHealth> {
  const { status, json } = await call('GET', '/smart-search/health', undefined, { anonymous: true });
  if (status !== 200 && status !== 503) fail(status, json);
  return {
    reachable: status === 200 && json?.reachable !== false,
    currencyDate: json?.currencyDate ?? null,
    coverage: json?.coverage,
  };
}
