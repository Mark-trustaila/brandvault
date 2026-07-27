/**
 * Routes served without a Clerk session.
 *
 * Extracted from middleware.ts so the list is importable and testable: adding a
 * public route is a security-relevant edit, and a test that names each one makes
 * an accidental addition visible in review rather than buried in a matcher.
 *
 * Everything not listed here requires auth.
 */
export const PUBLIC_ROUTE_PATTERNS = [
  '/sign-in(.*)',
  '/sign-up(.*)',
  // Slack and cron endpoints carry no Clerk session — Slack signs its requests,
  // cron uses CRON_SECRET, and the routes enforce their own auth — so
  // auth.protect() must not block them.
  '/api/slack/(.*)',
  '/api/cron/(.*)',
  // Postmark inbound webhook — no Clerk session; verified by its own shared
  // secret. Must be public or auth.protect() would 404 it.
  '/api/email/(.*)',
  // The changelog. Renders a hardcoded entries array and reads no database, no
  // tenant and no user, so there is nothing here to scope to a session. Public
  // so a reviewer can open it without an account. It is the ONLY page route on
  // this list; everything else public is a machine endpoint.
  '/whats-new',
] as const;
