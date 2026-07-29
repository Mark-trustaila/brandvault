/**
 * Registry facade client (server-side ONLY).
 * ==========================================
 * Thin client for the read-only registry facade in front of BaseX GB.
 * Contract: docs/registry-facade-contract-v1.md (frozen v1).
 *
 * This module must never run in the browser — it holds two secrets. Both are
 * required on every authenticated call:
 *   - REGISTRY_FACADE_KEY      → x-brandvault-key header (the shared secret)
 *   - REGISTRY_FACADE_FN_KEY   → x-functions-key header  (the Azure Function key)
 *   - REGISTRY_FACADE_URL      → e.g. https://bv-registry-facade-stg.azurewebsites.net
 *
 * /registry/gb/health is anonymous (no keys) and used for currency/coverage.
 *
 * Known contract deviation (accepted): mark objects carry all_leaf_elements: []
 * when raw is false rather than omitting it — ignore the field.
 */

export interface OwnerMatch {
  ownerString: string;
  matchedVia: Array<'owner' | 'representative'>;
  markCount: number;
}

export interface Coverage {
  uk009: { partial: boolean; approxPct: number; note: string };
}

export interface SearchByOwnerResult {
  registry: string;
  currencyDate: string;
  coverage: Coverage;
  query: string;
  cap: number;
  owners: OwnerMatch[];
  totalDistinctMarks: number;
}

// The /marks body is the same { export, marks } doc shape as the export file,
// so it drops straight into readExportDoc() in scripts/gb-transform.ts.
export interface MarksDoc {
  registry: string;
  currencyDate: string;
  coverage: Coverage;
  cap: number;
  requestedOwnerStrings: string[];
  unmatchedOwnerStrings: string[];
  export: Record<string, unknown>;
  marks: unknown[];
}

export class FacadeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly body?: any,
  ) {
    super(message);
    this.name = 'FacadeError';
  }
}

/** Thrown by getMarks when the proprietor exceeds the server cap (HTTP 413). */
export class CapExceededError extends FacadeError {
  constructor(
    readonly matchedDistinctMarks: number,
    readonly cap: number,
    readonly ownerBreakdown: OwnerMatch[],
    body?: any,
  ) {
    super('CAP_EXCEEDED', `Result set (${matchedDistinctMarks}) exceeds cap (${cap}).`, 413, body);
    this.name = 'CapExceededError';
  }
}

const DEFAULT_TIMEOUT_MS = 25_000;

function config() {
  const url = process.env.REGISTRY_FACADE_URL;
  const key = process.env.REGISTRY_FACADE_KEY;
  const fnKey = process.env.REGISTRY_FACADE_FN_KEY;
  if (!url) throw new FacadeError('CONFIG', 'REGISTRY_FACADE_URL is not set', 0);
  return { url: url.replace(/\/$/, ''), key: key ?? '', fnKey: fnKey ?? '' };
}

async function call<T>(
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
    throw new FacadeError(timedOut ? 'TIMEOUT' : 'NETWORK', `facade ${method} ${path}: ${e?.message ?? e}`, 0);
  }
  let json: any = null;
  try { json = await res.json(); } catch { /* leave null */ }
  return { status: res.status, json };
}

/** POST /registry/gb/search-by-owner — proprietor search (checkbox step). */
export async function searchByOwner(query: string, registry = 'gb'): Promise<SearchByOwnerResult> {
  const { status, json } = await call('POST', `/registry/${registry}/search-by-owner`, { query });
  if (status !== 200) {
    throw new FacadeError(json?.error?.code ?? 'HTTP_' + status, json?.error?.message ?? `HTTP ${status}`, status, json);
  }
  return json as SearchByOwnerResult;
}

/**
 * POST /registry/gb/marks — full mark documents for the chosen owner strings.
 * Returns the { export, marks } doc for scripts/gb-transform.ts#readExportDoc.
 * Throws CapExceededError (413) so callers can render "contact us".
 */
export async function getMarks(ownerStrings: string[], registry = 'gb'): Promise<MarksDoc> {
  const { status, json } = await call('POST', `/registry/${registry}/marks`, { ownerStrings });
  if (status === 413 && json?.error?.code === 'CAP_EXCEEDED') {
    throw new CapExceededError(json.matchedDistinctMarks, json.cap, json.ownerBreakdown ?? [], json);
  }
  if (status !== 200) {
    throw new FacadeError(json?.error?.code ?? 'HTTP_' + status, json?.error?.message ?? `HTTP ${status}`, status, json);
  }
  return json as MarksDoc;
}

/** GET /registry/gb/mark/{applicationNumber} — one mark, or null on 404. */
export async function getMark(applicationNumber: string, registry = 'gb'): Promise<any | null> {
  const { status, json } = await call('GET', `/registry/${registry}/mark/${encodeURIComponent(applicationNumber)}`);
  if (status === 404) return null;
  if (status !== 200) {
    throw new FacadeError(json?.error?.code ?? 'HTTP_' + status, json?.error?.message ?? `HTTP ${status}`, status, json);
  }
  return json.mark;
}

/** GET /registry/gb/health — anonymous; currency + coverage + reachability. */
export async function health(registry = 'gb'): Promise<{ currencyDate: string; coverage: Coverage; baseXReachable: boolean; pauseHeavy: boolean }> {
  const { status, json } = await call('GET', `/registry/${registry}/health`, undefined, { anonymous: true });
  if (status !== 200 && status !== 503) {
    throw new FacadeError('HTTP_' + status, `health HTTP ${status}`, status, json);
  }
  return json;
}
