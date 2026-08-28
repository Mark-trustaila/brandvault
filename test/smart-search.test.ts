/**
 * The §3 client, against a stubbed facade.
 *
 * The contract is the interface: these tests pin what BrandVault sends and what
 * it makes of what comes back, so the mock can be deleted and the live facade
 * swapped in without a line of lib/ changing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  submitSearch, getSearch, health, normaliseResult, normaliseClasses,
  isConfigured, SmartSearchError,
} from '../lib/smart-search';
import { pollDelayMs, shouldKeepPolling, POLL_CAP_MS, timedOutMessage } from '../lib/smart-search-poll';

const BASE = 'http://facade.test';

type Call = { url: string; init: RequestInit };
let calls: Call[];

/** Queue of responses, consumed in order. */
function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { status: 500, body: null };
    return {
      status: next.status,
      json: async () => next.body,
    } as unknown as Response;
  }));
}

beforeEach(() => {
  calls = [];
  process.env.SMART_SEARCH_FACADE_URL = BASE;
  process.env.SMART_SEARCH_FACADE_KEY = 'bv-key';
  process.env.SMART_SEARCH_FACADE_FN_KEY = 'fn-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SMART_SEARCH_FACADE_URL;
  delete process.env.SMART_SEARCH_FACADE_KEY;
  delete process.env.SMART_SEARCH_FACADE_FN_KEY;
  delete process.env.REGISTRY_FACADE_URL;
});

describe('normaliseClasses', () => {
  it('accepts a comma string, an array of strings and an array of numbers alike', () => {
    expect(normaliseClasses('35, 36')).toEqual(['35', '36']);
    expect(normaliseClasses(['35', '36'])).toEqual(['35', '36']);
    expect(normaliseClasses([35, 36])).toEqual(['35', '36']);
  });

  it('dedupes and sorts, so one request has one spelling', () => {
    expect(normaliseClasses('9, 42, 9')).toEqual(['9', '42']);
    expect(normaliseClasses('42,9')).toEqual(normaliseClasses('9,42'));
  });

  it('drops what is not a Nice class rather than submitting it', () => {
    expect(normaliseClasses('0, 46, abc, , 25')).toEqual(['25']);
    expect(normaliseClasses(null)).toEqual([]);
  });
});

describe('config', () => {
  it('falls back to the registry facade host and keys', async () => {
    delete process.env.SMART_SEARCH_FACADE_URL;
    process.env.REGISTRY_FACADE_URL = 'http://shared.test';
    stubFetch([{ status: 200, body: { search_id: 'x', status: 'running' } }]);
    await submitSearch({ term: 'ASOS' });
    expect(calls[0].url).toBe('http://shared.test/smart-search/gb/search');
  });

  it('refuses with CONFIG when no base URL is set anywhere', async () => {
    delete process.env.SMART_SEARCH_FACADE_URL;
    expect(isConfigured()).toBe(false);
    await expect(submitSearch({ term: 'ASOS' })).rejects.toMatchObject({ code: 'CONFIG' });
  });
});

describe('submitSearch', () => {
  it('sends the §3.1 body and both auth headers', async () => {
    stubFetch([{ status: 200, body: { search_id: 'abc', status: 'running' } }]);
    const out = await submitSearch({ term: '  ASOS  ', classes: '25, 35', markRef: 'UK00002530115' });

    expect(out).toEqual({ search_id: 'abc', status: 'running' });
    expect(calls[0].url).toBe(`${BASE}/smart-search/gb/search`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      term: 'ASOS', classes: ['25', '35'], mark_ref: 'UK00002530115',
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-brandvault-key']).toBe('bv-key');
    expect(headers['x-functions-key']).toBe('fn-key');
  });

  it('omits mark_ref when there is no mark to attribute it to', async () => {
    stubFetch([{ status: 200, body: { search_id: 'abc', status: 'running' } }]);
    await submitSearch({ term: 'ASOS' });
    expect(JSON.parse(calls[0].init.body as string)).not.toHaveProperty('mark_ref');
  });

  it('takes the registry as a path parameter', async () => {
    stubFetch([{ status: 200, body: { search_id: 'abc', status: 'running' } }]);
    await submitSearch({ term: 'ASOS' }, 'wo');
    expect(calls[0].url).toBe(`${BASE}/smart-search/wo/search`);
  });

  it('rejects an empty term before spending a call', async () => {
    stubFetch([]);
    await expect(submitSearch({ term: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(calls).toHaveLength(0);
  });

  it('surfaces the facade error code', async () => {
    stubFetch([{ status: 501, body: { error: { code: 'REGISTRY_NOT_IMPLEMENTED', message: 'no eu' } } }]);
    await expect(submitSearch({ term: 'ASOS' }, 'eu')).rejects.toMatchObject({
      code: 'REGISTRY_NOT_IMPLEMENTED', httpStatus: 501,
    });
  });
});

describe('getSearch', () => {
  const completed = {
    search_id: 'abc', status: 'completed', term: 'ASOS', classes: ['25'], registry: 'gb',
    currencyDate: '2026-07-11', coverage: { uk009: { partial: true, note: 'partial' } },
    failure_reason: null, mark_ref: 'UK00002530115',
    results: [{ id: 'h1', score: 92, similarity: 'Very high', class_match: 1, application_number: 'UK00004300780', classes: '25', status: 'Registered', mark_string: 'ASOS', registry: 'gb', application_date: '2025-11-25', owner: 'Someone Ltd' }],
  };

  it('returns a completed search with its hits, currency and coverage', async () => {
    stubFetch([{ status: 200, body: completed }]);
    const r = await getSearch('abc');
    expect(r.status).toBe('completed');
    expect(r.results).toHaveLength(1);
    expect(r.currencyDate).toBe('2026-07-11');
    expect(r.coverage?.uk009?.partial).toBe(true);
    expect(r.mark_ref).toBe('UK00002530115');
  });

  // §3.3: a search that ran and did not succeed is data, not an exception.
  it('returns a failed search rather than throwing', async () => {
    stubFetch([{ status: 200, body: { ...completed, status: 'failed', results: null, failure_reason: 'worker timed out' } }]);
    const r = await getSearch('abc');
    expect(r.status).toBe('failed');
    expect(r.failure_reason).toBe('worker timed out');
    expect(r.results).toBeNull();
  });

  it('throws only when the transport does', async () => {
    stubFetch([{ status: 404, body: { error: { code: 'SEARCH_NOT_FOUND', message: 'unknown' } } }]);
    await expect(getSearch('nope')).rejects.toMatchObject({ code: 'SEARCH_NOT_FOUND', httpStatus: 404 });
  });

  it('reports a network failure as NETWORK, not as an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(getSearch('abc')).rejects.toBeInstanceOf(SmartSearchError);
    await expect(getSearch('abc')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

describe('normaliseResult', () => {
  // §6 q1 leaves the exact terminal strings to Unit A's first live smoke.
  it('reads an unrecognised status as running, never as an empty completed', () => {
    const r = normaliseResult('abc', { status: 'Searching', results: null });
    expect(r.status).toBe('running');
    expect(r.results).toBeNull();
  });

  it('is case-insensitive about the settled statuses', () => {
    expect(normaliseResult('abc', { status: 'Completed', results: [] }).status).toBe('completed');
    expect(normaliseResult('abc', { status: 'FAILED' }).status).toBe('failed');
  });

  it('gives a completed search an array even when the facade sends nothing', () => {
    expect(normaliseResult('abc', { status: 'completed' }).results).toEqual([]);
  });

  it('never presents a running search as having no hits', () => {
    expect(normaliseResult('abc', { status: 'running', results: [] }).results).toBeNull();
  });

  // The cap discipline has to survive the normalisation, or the panel cannot
  // warn about a capped list and the list reads as the whole register.
  it('carries the cap fields through', () => {
    const r = normaliseResult('abc', {
      status: 'completed', results: [], result_count: 2000, total_available: 4318,
      cap: 2000, truncated: true,
    });
    expect(r).toMatchObject({ result_count: 2000, total_available: 4318, cap: 2000, truncated: true });
  });

  // The deployed shape for an upstream-capped search: the total is genuinely
  // unknown, so it arrives null with a floor and a ceiling beside it.
  it('carries the unknown-total shape: null total, floor, upstream ceiling', () => {
    const r = normaliseResult('abc', {
      status: 'completed', results: [], result_count: 250, total_available: null,
      total_at_least: 250, upstream_cap: 250, cap: 2000, truncated: true,
    });
    expect(r).toMatchObject({
      result_count: 250, total_available: null, total_at_least: 250,
      upstream_cap: 250, truncated: true,
    });
  });

  it('defaults truncated to false and the counts to null when the facade omits them', () => {
    const r = normaliseResult('abc', { status: 'completed', results: [] });
    expect(r.truncated).toBe(false);
    expect(r.result_count).toBeNull();
    expect(r.total_available).toBeNull();
    expect(r.total_at_least).toBeNull();
    expect(r.upstream_cap).toBeNull();
    expect(r.cap).toBeNull();
  });

  it('reads a truthy-but-not-true truncated as not truncated', () => {
    expect(normaliseResult('abc', { status: 'completed', truncated: 1 }).truncated).toBe(false);
  });
});

describe('health', () => {
  it('is anonymous — no keys on the wire', async () => {
    stubFetch([{ status: 200, body: { reachable: true, currencyDate: '2026-07-11' } }]);
    const h = await health();
    expect(h.reachable).toBe(true);
    expect(h.currencyDate).toBe('2026-07-11');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-brandvault-key']).toBeUndefined();
    expect(headers['x-functions-key']).toBeUndefined();
  });

  it('treats 503 as an answer, not an error — that is what unreachable looks like', async () => {
    stubFetch([{ status: 503, body: { reachable: false, currencyDate: null } }]);
    await expect(health()).resolves.toMatchObject({ reachable: false });
  });
});

describe('poll policy', () => {
  it('starts quickly and settles to a ceiling', () => {
    expect(pollDelayMs(1)).toBe(1000);
    expect(pollDelayMs(3)).toBe(3000);
    expect(pollDelayMs(50)).toBe(4000);
  });

  it('stops the moment a search settles, failure included', () => {
    expect(shouldKeepPolling('completed', 0)).toBe(false);
    expect(shouldKeepPolling('failed', 0)).toBe(false);
    expect(shouldKeepPolling('running', 0)).toBe(true);
  });

  it('gives up at the cap', () => {
    expect(shouldKeepPolling('running', POLL_CAP_MS - 1)).toBe(true);
    expect(shouldKeepPolling('running', POLL_CAP_MS)).toBe(false);
  });

  it('says the register may still be running, not that nothing was found', () => {
    const msg = timedOutMessage('abc');
    expect(msg).toMatch(/may still be running/i);
    expect(msg).toMatch(/nothing here says the term is clear/i);
    expect(msg).toContain('abc');
  });
});
