import { NextResponse } from 'next/server';
import { getRequestContext } from '../../../../../lib/authz';
import { getSearch, SmartSearchError } from '../../../../../lib/smart-search';
import { emitIfWatch } from '../../../../../lib/smart-search-notice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/smart-search/{id}/notice — emit `watch.notice` for a completed
 * watch search (contract §7, Core contract §3).
 *
 * DARK. Nothing in the UI calls it: v1 ships one-shot clearance only, and a
 * clearance search shows inline and emits nothing. It exists so the hook is
 * built to the right shape, testable, and ready for the watch recurrence that
 * §6 q5 defers to v1.x — at which point the caller is a scheduled run, not a
 * person clicking.
 *
 * With AILA_CORE_URL / AILA_CORE_APP_KEY unset, lib/ailaCore.ts makes every
 * emit a no-op reporting `unconfigured`, which is what this returns today.
 *
 * Deliberately not folded into the poll route. Core dedupes on
 * (app, event_id) and every emit mints a fresh id, so a poll that emitted would
 * send one notice per poll — the UI polls until settled. One explicit call,
 * once, by something that knows it means it.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { ctx, error } = await getRequestContext(req);
  if (error) return NextResponse.json({ error: error.message }, { status: error.status });

  const body = await req.json().catch(() => null);

  let result;
  try {
    result = await getSearch(params.id);
  } catch (e) {
    if (e instanceof SmartSearchError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.httpStatus === 404 ? 404 : 502 });
    }
    throw e;
  }

  const emitted = await emitIfWatch(ctx.company.id, result, 'watch', {
    markRef: typeof body?.markRef === 'string' ? body.markRef : null,
    markText: typeof body?.markText === 'string' ? body.markText : null,
  });

  // Null means the search warranted no notice — still running, failed, or with
  // no mark to anchor to. Reported as its own outcome so a caller can tell it
  // from a send that Core refused.
  if (!emitted) {
    return NextResponse.json({ emitted: false, outcome: 'not-applicable', status: result.status });
  }
  return NextResponse.json({ emitted: emitted.ok, outcome: emitted.outcome, eventId: emitted.eventId });
}
