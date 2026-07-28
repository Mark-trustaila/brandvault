'use client';

/**
 * Client-side "acting company" for platform admins. When set, API calls carry
 * the x-bv-company-id header so reads + writes act on that company (cross-tenant).
 * Persisted in localStorage; null means "my own org".
 */
export type ActingCompany = { id: string; name: string } | null;

const KEY = 'bv_acting_company';

export function getActingCompany(): ActingCompany {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function setActingCompany(c: ActingCompany): void {
  if (typeof window === 'undefined') return;
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
}

/**
 * The server's wording when x-bv-company-id names a company that is gone.
 *
 * Duplicated rather than imported: lib/authz.ts pulls in Prisma and Clerk, and
 * importing it here would drag the server into the client bundle. A test pins
 * this against TARGET_COMPANY_MISSING_MESSAGE so the pair cannot drift.
 */
export const TARGET_COMPANY_MISSING = 'Target company not found';

/**
 * Does this response mean the stored acting company no longer exists?
 *
 * Pure, and deliberately narrow. A bare 404 is not enough: plenty of routes
 * legitimately 404 for a missing notification or mark, and clearing the acting
 * company on those would yank a platform admin out of the tenant they are
 * working in. Only the server's specific message counts.
 */
export function isStaleActingCompany(status: number, errorMessage: unknown): boolean {
  return status === 404 && errorMessage === TARGET_COMPANY_MISSING;
}

/**
 * fetch() that adds the cross-tenant header when an acting company is set, and
 * drops that company as soon as the server says it no longer exists.
 *
 * Without the self-heal a deleted company left a dead id in localStorage that
 * 404s every write while reads silently fall back to the home company, so the
 * app looks healthy and every save fails. Nothing in the UI explained it.
 */
export async function bvFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const acting = getActingCompany();
  const headers = new Headers(init.headers);
  if (acting) headers.set('x-bv-company-id', acting.id);
  const res = await fetch(input, { ...init, headers });

  if (acting && res.status === 404) {
    // clone() so the caller still gets an unread body.
    const detail = await res.clone().json().then((d) => d?.error).catch(() => null);
    if (isStaleActingCompany(res.status, detail)) setActingCompany(null);
  }
  return res;
}
