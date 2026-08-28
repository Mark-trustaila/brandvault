import { NextResponse } from 'next/server';
import { getRequestContext } from '../../../lib/authz';
import { rateLimit, SMART_SEARCH_LIMIT } from '../../../lib/import-events';
import { submitSearch, isConfigured, SmartSearchError } from '../../../lib/smart-search';

// Calls the facade at request time and reads env; never statically evaluated.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REGISTRIES = new Set(['gb', 'wo']); // §3.1: gb + wo to start

/**
 * POST /api/smart-search — submit a clearance or watch search.
 *
 * Server-side because the facade keys live here and must not reach the browser
 * (contract §4). The body is the §3.1 body plus the registry.
 *
 * `allowViewer: true`, the fourth opt-out from the viewer write gate. A search
 * writes nothing — no mark, no note, no family, no tenant data changes — and is
 * a POST only because a term and a class list need a body. That is the stated
 * criterion for the opt-out, and the alternative is that in-house counsel on a
 * viewer seat cannot run a clearance search at all, which is most of the reason
 * they would open BrandVault. test/viewer-write-gate.test.ts pins the list, so
 * this addition is visible and reversible in one place.
 */
export async function POST(req: Request) {
  const { ctx, error } = await getRequestContext(req, { allowViewer: true });
  if (error) return NextResponse.json({ error: error.message }, { status: error.status });

  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Smart Search is not configured for this deployment', code: 'NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const term = typeof body?.term === 'string' ? body.term.trim() : '';
  if (term.length < 2 || term.length > 120) {
    return NextResponse.json({ error: 'term must be 2–120 characters' }, { status: 400 });
  }
  const registry = typeof body?.registry === 'string' ? body.registry.toLowerCase() : 'gb';
  if (!REGISTRIES.has(registry)) {
    return NextResponse.json({ error: `registry ${registry} is not available`, code: 'REGISTRY_NOT_IMPLEMENTED' }, { status: 501 });
  }

  const rl = await rateLimit(
    `smart-search:${ctx.company.id}`,
    SMART_SEARCH_LIMIT.max,
    SMART_SEARCH_LIMIT.windowMs,
    new Date(),
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Search limit reached; resets ${rl.resetAt.toISOString()}` },
      { status: 429 },
    );
  }

  try {
    const submission = await submitSearch(
      { term, classes: body?.classes, markRef: typeof body?.markRef === 'string' ? body.markRef : null },
      registry,
    );
    return NextResponse.json(submission);
  } catch (e) {
    if (e instanceof SmartSearchError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    }
    throw e;
  }
}
