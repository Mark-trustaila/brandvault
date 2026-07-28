import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal sessionStorage stand-in; jsdom is not configured for this suite.
const store = new Map<string, string>();
const sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
vi.stubGlobal('window', { sessionStorage });

import { cacheKey, readCache, writeCache, clearCache, staleWhileRevalidate } from '../lib/client/dashboard-cache';

beforeEach(() => store.clear());

describe('cacheKey', () => {
  // A platform admin switching tenants must never read the previous one's
  // portfolio out of the cache.
  it('scopes by company so two tenants cannot collide', () => {
    expect(cacheKey('trademarks', 'c1')).not.toBe(cacheKey('trademarks', 'c2'));
  });

  it('has a stable key for the home company', () => {
    expect(cacheKey('trademarks', null)).toBe(cacheKey('trademarks', null));
    expect(cacheKey('trademarks', null)).toContain('home');
  });

  it('separates different payloads', () => {
    expect(cacheKey('trademarks', null)).not.toBe(cacheKey('notifications', null));
  });
});

describe('read/write', () => {
  it('round-trips a value', () => {
    writeCache('k', { count: 222 });
    expect(readCache<{ count: number }>('k')).toEqual({ count: 222 });
  });

  it('returns null for a miss', () => {
    expect(readCache('nope')).toBeNull();
  });

  it('returns null rather than throwing on corrupt JSON', () => {
    store.set('bad', '{not json');
    expect(readCache('bad')).toBeNull();
  });
});

describe('clearCache', () => {
  it('removes our keys and leaves everything else alone', () => {
    writeCache(cacheKey('trademarks', 'c1'), { a: 1 });
    writeCache(cacheKey('notifications', 'c1'), { b: 2 });
    store.set('unrelated', 'keep me');
    clearCache();
    expect(readCache(cacheKey('trademarks', 'c1'))).toBeNull();
    expect(readCache(cacheKey('notifications', 'c1'))).toBeNull();
    expect(store.get('unrelated')).toBe('keep me');
  });
});

describe('staleWhileRevalidate', () => {
  it('emits the cached value first, then the fresh one', async () => {
    writeCache('k', { v: 'old' });
    const seen: [unknown, string][] = [];
    await staleWhileRevalidate('k', async () => ({ v: 'new' }), (d, src) => seen.push([d, src]));
    expect(seen).toEqual([[{ v: 'old' }, 'cache'], [{ v: 'new' }, 'network']]);
  });

  it('emits once when there is no cache', async () => {
    const seen: string[] = [];
    await staleWhileRevalidate('k', async () => ({ v: 'new' }), (_d, src) => seen.push(src));
    expect(seen).toEqual(['network']);
  });

  it('writes the fresh value back', async () => {
    await staleWhileRevalidate('k', async () => ({ v: 'new' }), () => {});
    expect(readCache('k')).toEqual({ v: 'new' });
  });

  // A stale render beats an error state for data that is merely out of date.
  it('keeps the cached render when revalidation fails', async () => {
    writeCache('k', { v: 'old' });
    const seen: string[] = [];
    await staleWhileRevalidate('k', async () => { throw new Error('offline'); }, (_d, src) => seen.push(src));
    expect(seen).toEqual(['cache']);
    expect(readCache('k')).toEqual({ v: 'old' });
  });

  it('does not cache a null response', async () => {
    await staleWhileRevalidate('k', async () => null, () => {});
    expect(readCache('k')).toBeNull();
  });
});
