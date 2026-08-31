import { NextResponse } from 'next/server';
import { getRequestContext } from '../../../../../lib/authz';
import { applyHitReviews, RecordNotFound, type ReviewUpdate } from '../../../../../lib/clearance';
import { isTier } from '../../../../../lib/clearance-review';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_UPDATES = 500; // more than a capped result set can hold

/**
 * PATCH /api/clearance/{id}/hits — record judgement on hits, in bulk.
 *
 * PATCH is a mutating verb, so the shared gate denies viewers before this runs
 * and no per-route role check is needed.
 *
 * Only the fields present on an update are written. Sending a note must not
 * reset a tier, and applying a tier must not wipe someone's note.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { ctx, error } = await getRequestContext(req);
  if (error) return NextResponse.json({ error: error.message }, { status: error.status });

  const body = await req.json().catch(() => null);
  const raw = Array.isArray(body?.updates) ? body.updates : null;
  if (!raw) return NextResponse.json({ error: 'updates must be an array' }, { status: 400 });
  if (raw.length > MAX_UPDATES) {
    return NextResponse.json({ error: `at most ${MAX_UPDATES} updates per request` }, { status: 400 });
  }

  const updates: ReviewUpdate[] = [];
  for (const u of raw) {
    const applicationNumber = typeof u?.applicationNumber === 'string' ? u.applicationNumber.trim() : '';
    if (!applicationNumber) {
      return NextResponse.json({ error: 'every update needs an applicationNumber' }, { status: 400 });
    }
    if (u.tier !== undefined && !isTier(u.tier)) {
      return NextResponse.json({ error: `tier must be highlight, appendix or exclude (got ${JSON.stringify(u.tier)})` }, { status: 400 });
    }
    updates.push({
      applicationNumber,
      ...(u.tier !== undefined ? { tier: u.tier } : {}),
      ...(u.note !== undefined ? { note: typeof u.note === 'string' ? u.note : null } : {}),
      ...(u.position !== undefined ? { position: typeof u.position === 'number' ? u.position : null } : {}),
    });
  }

  try {
    const out = await applyHitReviews(ctx.company.id, params.id, updates, ctx.user.clerkUserId);
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof RecordNotFound) {
      return NextResponse.json({ error: 'No such clearance search' }, { status: 404 });
    }
    throw e;
  }
}
