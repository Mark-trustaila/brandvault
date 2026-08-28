/**
 * The Unit C hook: what a completed search tells AiLA Core, and — mostly — what
 * it does not.
 *
 * The rules being pinned are the ones that would be expensive to get wrong once
 * Core exists: a clearance search must never emit, and a failure must never
 * reach a feed dressed as a clean result.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  noticeFor, noticeSummary, noticeImportance, tallyHits, resultsDeepLink, emitIfWatch,
} from '../lib/smart-search-notice';
import type { SmartSearchHit, SmartSearchResult } from '../lib/smart-search';

const hit = (over: Partial<SmartSearchHit> = {}): SmartSearchHit => ({
  id: Math.random().toString(36).slice(2),
  score: 50, similarity: 'Low', class_match: 0,
  application_number: 'UK00004300780', classes: '25', status: 'Registered',
  mark_string: 'BLOC', registry: 'gb', application_date: '2025-11-25', owner: 'Someone Ltd',
  ...over,
});

const result = (over: Partial<SmartSearchResult> = {}): SmartSearchResult => ({
  search_id: 'srch-1', status: 'completed', term: 'BLOC', classes: ['25'], registry: 'gb',
  currencyDate: '2026-07-11', results: [], failure_reason: null, mark_ref: 'UK00002530115',
  result_count: 0, total_available: 0, total_at_least: null, upstream_cap: null, cap: 2000, truncated: false,
  ...over,
});

describe('tallyHits', () => {
  it('counts the verdicts as the engine gave them', () => {
    const t = tallyHits([
      hit({ similarity: 'Very high', class_match: 1 }),
      hit({ similarity: 'very high' }),
      hit({ similarity: 'High', class_match: 1 }),
      hit({ similarity: 'Low' }),
    ]);
    expect(t).toEqual({ veryHigh: 2, high: 1, classMatches: 2, total: 4 });
  });

  it('still counts a verdict it does not recognise', () => {
    const t = tallyHits([hit({ similarity: 'Exact' }), hit({ similarity: null })]);
    expect(t.total).toBe(2);
    expect(t.veryHigh + t.high).toBe(0);
  });
});

describe('noticeSummary', () => {
  it('leads with the severest count, as the contract example does', () => {
    const hits = [hit({ similarity: 'Very high' }), hit({ similarity: 'Very high' }), hit({ similarity: 'Very high' }), hit({ similarity: 'High' })];
    expect(noticeSummary('BLOC', hits)).toBe('3 very-high hits for BLOC');
  });

  it('gets the singular right', () => {
    expect(noticeSummary('BLOC', [hit({ similarity: 'Very high' })])).toBe('1 very-high hit for BLOC');
  });

  it('falls back to high, then to a plain count', () => {
    expect(noticeSummary('BLOC', [hit({ similarity: 'High' })])).toBe('1 high hit for BLOC');
    expect(noticeSummary('BLOC', [hit({ similarity: 'Low' }), hit({ similarity: 'Low' })])).toBe('2 hits for BLOC, none rated high');
  });

  // A watch that only speaks up when it finds something teaches nobody whether
  // it ran. A clean week is reported as a clean week.
  it('reports a clean result as a result', () => {
    expect(noticeSummary('BLOC', [])).toBe('No hits for BLOC');
  });
});

describe('noticeImportance', () => {
  it('puts a very-high hit in an overlapping class at the top', () => {
    expect(noticeImportance([hit({ similarity: 'Very high', class_match: 1 })])).toBe(5);
    expect(noticeImportance([hit({ similarity: 'Very high', class_match: 0 })])).toBe(4);
  });

  it('grades down through high, some, and none', () => {
    expect(noticeImportance([hit({ similarity: 'High' })])).toBe(3);
    expect(noticeImportance([hit({ similarity: 'Low' })])).toBe(2);
    expect(noticeImportance([])).toBe(1);
  });
});

describe('noticeFor', () => {
  it('builds the §7 payload for a completed watch', () => {
    const plan = noticeFor(
      result({ results: [hit({ similarity: 'Very high', class_match: 1 })] }),
      'watch',
      { markRef: 'UK00002530115', markText: 'ASOS', base: 'https://bv.test' },
    );
    expect(plan).toEqual({
      markRef: 'UK00002530115',
      noticeRef: 'srch-1',
      noticeSummary: '1 very-high hit for BLOC',
      deepLink: 'https://bv.test/clearance?search=srch-1',
      title: 'Watch: ASOS (UK00002530115)',
      importance: 5,
    });
  });

  // §7: a one-shot clearance search shows inline and does not emit.
  it('emits nothing for a clearance search, however alarming the hits', () => {
    const hits = [hit({ similarity: 'Very high', class_match: 1 })];
    expect(noticeFor(result({ results: hits }), 'clearance')).toBeNull();
  });

  it('emits nothing while a search is still running', () => {
    expect(noticeFor(result({ status: 'running', results: null }), 'watch')).toBeNull();
  });

  // "0 hits" and "we did not look" are opposite claims. A failure is never
  // dressed as the first.
  it('emits nothing for a failed search', () => {
    expect(noticeFor(result({ status: 'failed', results: null, failure_reason: 'worker timed out' }), 'watch')).toBeNull();
  });

  it('emits nothing with no mark to anchor to, rather than inventing one', () => {
    expect(noticeFor(result({ mark_ref: null, results: [hit()] }), 'watch')).toBeNull();
  });

  it('takes the mark ref from the caller over the facade echo', () => {
    const plan = noticeFor(result({ results: [hit()] }), 'watch', { markRef: 'UK00003190037' });
    expect(plan?.markRef).toBe('UK00003190037');
  });

  it('titles by the search term when no mark text is to hand', () => {
    const plan = noticeFor(result({ results: [hit()] }), 'watch', { markRef: 'UK00002530115' });
    expect(plan?.title).toBe('Watch: BLOC (UK00002530115)');
  });
});

describe('resultsDeepLink', () => {
  it('points at the result, by id', () => {
    expect(resultsDeepLink('a b/c', 'https://bv.test')).toBe('https://bv.test/clearance?search=a%20b%2Fc');
  });
});

describe('emitIfWatch', () => {
  beforeEach(() => {
    delete process.env.AILA_CORE_URL;
    delete process.env.AILA_CORE_APP_KEY;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('is null — not a failed send — when there is nothing to emit', async () => {
    await expect(emitIfWatch('co-1', result({ results: [hit()] }), 'clearance')).resolves.toBeNull();
  });

  // Dark until Core exists: unset env makes the emit a no-op that says so,
  // which is distinct from a send Core refused.
  it('reports unconfigured while Core has no URL or key', async () => {
    const out = await emitIfWatch('co-1', result({ results: [hit()] }), 'watch', { markRef: 'UK00002530115' });
    expect(out).toMatchObject({ ok: false, outcome: 'unconfigured', eventId: null });
  });

  it('sends the Core envelope once Core is configured', async () => {
    process.env.AILA_CORE_URL = 'https://core.test';
    process.env.AILA_CORE_APP_KEY = 'k';
    const sent: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(init.body as string), headers: init.headers });
      return { status: 202, text: async () => '' } as unknown as Response;
    }));

    const out = await emitIfWatch(
      'co-1',
      result({ results: [hit({ similarity: 'Very high', class_match: 1 })] }),
      'watch',
      { markRef: 'UK00002530115', markText: 'ASOS' },
    );

    expect(out).toMatchObject({ ok: true, outcome: 'delivered' });
    expect(sent[0].url).toBe('https://core.test/v1/events');
    expect(sent[0].body).toMatchObject({
      app: 'brandvault',
      app_tenant_ref: 'co-1',
      type: 'watch.notice',
      payload: {
        mark_ref: 'UK00002530115',
        notice_ref: 'srch-1',
        notice_summary: '1 very-high hit for BLOC',
        title: 'Watch: ASOS (UK00002530115)',
        importance: 5,
      },
    });
    expect(sent[0].headers['x-aila-app-key']).toBe('k');
  });
});
