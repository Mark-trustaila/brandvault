'use client';

/**
 * Stale-while-revalidate cache for authenticated dashboard payloads.
 *
 * Render instantly from the last response, then refresh in the background. The
 * dashboard's own data is the slow part (a 3.0MB portfolio behind a
 * transatlantic query), and a returning visit does not need to stare at nothing
 * while it re-fetches something it already had.
 *
 * **sessionStorage, not localStorage.** This is one tenant's portfolio: it
 * should not outlive the tab, and it must never be readable by a later user of
 * the same browser profile. sessionStorage is per-tab and cleared when the tab
 * closes. Nothing here is cached server side or at the edge, so no
 * authenticated response is ever shared between users.
 *
 * **Keys are scoped by acting company.** A platform admin switching tenants
 * must not see the previous tenant's cache, so the company id is part of the
 * key and `clearCache` runs on every switch.
 *
 * Every operation is wrapped: sessionStorage throws in private mode and when
 * over quota, and a cache is never worth failing a page load for.
 */

// Bump to invalidate every cached payload after a shape change.
const VERSION = 'v1';
const PREFIX = `bv:${VERSION}:`;

/** Cache key for a payload, scoped to the company being acted on. */
export function cacheKey(name: string, companyId: string | null): string {
  return `${PREFIX}${name}:${companyId ?? 'home'}`;
}

export function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage unavailable. A miss next time is the only cost.
  }
}

/** Drop every cached payload. Called when the acting company changes. */
export function clearCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}

/**
 * Read the cache, then revalidate in the background.
 *
 * `onData` fires once with the cached value when there is one, and again with
 * the fresh response. A failed revalidation is swallowed: the cached render is
 * better than an error state for data that is merely stale.
 */
export async function staleWhileRevalidate<T>(
  key: string,
  fetcher: () => Promise<T | null>,
  onData: (value: T, source: 'cache' | 'network') => void
): Promise<void> {
  const cached = readCache<T>(key);
  if (cached) onData(cached, 'cache');
  try {
    const fresh = await fetcher();
    if (fresh) {
      onData(fresh, 'network');
      writeCache(key, fresh);
    }
  } catch {
    /* keep the cached render */
  }
}
