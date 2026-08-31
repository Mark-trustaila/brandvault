import { NextResponse } from 'next/server';
import { getActingCompany } from '../../../../lib/authz';
import { getMark, searchByOwner, FacadeError } from '../../../../lib/registry-facade';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/registry/mark?registry=&applicationNumber=&owner= — one register
 * record, plus what else that owner holds.
 *
 * Server-side because lib/registry-facade holds two secrets. Not in the route
 * list in docs/clearance-workflow.md §3, but §5 needs the full specification
 * and the owner's other marks, and the browser cannot reach the facade itself.
 *
 * A read, so an ordinary member sees it. Company scoping is a gate on being
 * signed in at all rather than on the data: this returns public register
 * records, which belong to no tenant.
 *
 * GB only, because the registry facade implements GB only (contract A0). A WO
 * hit gets `available: false` and a reason, never a blank panel implying the
 * register holds nothing.
 */
export async function GET(req: Request) {
  const company = await getActingCompany(req);
  if (!company) return NextResponse.json({ error: 'No active organization' }, { status: 403 });

  const url = new URL(req.url);
  const registry = (url.searchParams.get('registry') ?? 'gb').toLowerCase();
  const applicationNumber = (url.searchParams.get('applicationNumber') ?? '').trim();
  const owner = (url.searchParams.get('owner') ?? '').trim();

  if (!applicationNumber) {
    return NextResponse.json({ error: 'applicationNumber is required' }, { status: 400 });
  }
  if (registry !== 'gb') {
    return NextResponse.json({
      available: false,
      registry,
      reason: `The full register record is not available for ${registry.toUpperCase()} yet — the registry facade implements GB only. The hit below is what the search returned.`,
    });
  }

  try {
    const mark = await getMark(applicationNumber, registry);
    // The owner's other marks are context, not the answer. A failure here must
    // not cost the caller the specification they came for.
    let ownerMarks: unknown[] = [];
    if (owner) {
      try {
        const found = await searchByOwner(owner, registry);
        ownerMarks = found.owners ?? [];
      } catch { ownerMarks = []; }
    }
    return NextResponse.json({
      available: true,
      registry,
      found: mark !== null,
      mark,
      ownerMarks,
      // A 404 is not proof of non-existence while UK009 coverage is partial;
      // the caller words it from this rather than assuming.
      notFoundIsNotProof: mark === null,
    });
  } catch (e) {
    if (e instanceof FacadeError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    }
    throw e;
  }
}
