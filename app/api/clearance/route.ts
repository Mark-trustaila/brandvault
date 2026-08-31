import { NextResponse } from 'next/server';
import { getRequestContext, getActingCompany } from '../../../lib/authz';
import { rateLimit, SMART_SEARCH_LIMIT } from '../../../lib/import-events';
import { submitSearch, getSearch, isConfigured, SmartSearchError } from '../../../lib/smart-search';
import { pollDelayMs, shouldKeepPolling, POLL_CAP_MS } from '../../../lib/smart-search-poll';
import { normaliseRegistry } from '../../../lib/smart-search-registries';
import { saveSearch, listSearches } from '../../../lib/clearance';
import { matchesHistory } from '../../../lib/clearance-review';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A search settles in about 23 seconds and the client policy gives up at 90.
// 300 leaves room for the poll to run its full course and the record to be
// written, rather than the function dying with the search already paid for.
export const maxDuration = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /api/clearance — run a search and save it as a record.
 *
 * Submits, polls to settled and writes the record in one request. That blocks a
 * thread for the duration, which the contract warns against for the facade —
 * but the facade is serving many tenants and this is one lawyer waiting for one
 * answer, and a record that only exists if the browser stays open is worse. The
 * budget is the shipped 90-second cap, well inside maxDuration.
 *
 * Failure is saved too. A search that ran and did not answer is evidence, and
 * someone re-running it next week needs to see that it was tried.
 *
 * No allowViewer opt-out, unlike /api/smart-search. That route writes nothing
 * and is a POST only because a term needs a body; this one creates a record and
 * spends the search budget, so the shared gate denying viewers is correct.
 */
export async function POST(req: Request) {
  const { ctx, error } = await getRequestContext(req);
  if (error) return NextResponse.json({ error: error.message }, { status: error.status });

  if (!isConfigured()) {
    return NextResponse.json({ error: 'Smart Search is not configured for this deployment', code: 'NOT_CONFIGURED' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  const term = typeof body?.term === 'string' ? body.term.trim() : '';
  if (term.length < 2 || term.length > 120) {
    return NextResponse.json({ error: 'term must be 2–120 characters' }, { status: 400 });
  }
  const registry = normaliseRegistry(body?.registry);
  const markRef = typeof body?.markRef === 'string' ? body.markRef : null;
  const rerunOfId = typeof body?.rerunOfId === 'string' ? body.rerunOfId : null;

  // Same scope key as /api/smart-search, so the two entry points share one
  // budget rather than granting thirty each.
  const rl = await rateLimit(`smart-search:${ctx.company.id}`, SMART_SEARCH_LIMIT.max, SMART_SEARCH_LIMIT.windowMs, new Date());
  if (!rl.allowed) {
    return NextResponse.json({ error: `Search limit reached; resets ${rl.resetAt.toISOString()}` }, { status: 429 });
  }

  try {
    const { search_id } = await submitSearch({ term, classes: body?.classes, markRef }, registry);

    const startedAt = Date.now();
    let settled = null;
    for (let attempt = 1; ; attempt++) {
      const polled = await getSearch(search_id);
      const elapsed = Date.now() - startedAt;
      if (!shouldKeepPolling(polled.status, elapsed)) { settled = polled; break; }
      await sleep(pollDelayMs(attempt));
    }

    if (settled.status === 'running') {
      // Nothing saved: a record with no outcome would sit in the history
      // indistinguishable from one that failed. The id goes back so the search
      // is not lost if anyone wants to chase it.
      return NextResponse.json({
        error: `The register has not answered in ${Math.round(POLL_CAP_MS / 1000)} seconds. Nothing here says the term is clear.`,
        code: 'NOT_SETTLED',
        searchId: search_id,
      }, { status: 504 });
    }

    const { id } = await saveSearch({
      companyId: ctx.company.id,
      runBy: ctx.user.clerkUserId,
      result: settled,
      markRef,
      rerunOfId,
    });
    return NextResponse.json({ id, status: settled.status, searchId: search_id });
  } catch (e) {
    if (e instanceof SmartSearchError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    }
    throw e;
  }
}

/**
 * GET /api/clearance — the Clearances table. A read, so an ordinary member
 * sees it; company-scoped in listSearches, never by id alone.
 */
export async function GET(req: Request) {
  const company = await getActingCompany(req);
  if (!company) return NextResponse.json({ error: 'No active organization' }, { status: 403 });

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? 50);

  const rows = await listSearches(company.id, Number.isFinite(limit) ? limit : 50);
  // Filtered here rather than in SQL: the filter spans a JSON class array and a
  // name resolved from a second table, and a page of at most 200 rows is not
  // where this product's database time goes.
  const searches = q ? rows.filter((r) => matchesHistory(r, q)) : rows;
  return NextResponse.json({ searches, total: rows.length, filtered: searches.length });
}
