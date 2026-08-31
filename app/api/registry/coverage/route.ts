import { NextResponse } from 'next/server';
import { health, FacadeError } from '../../../../lib/registry-facade';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/registry/coverage — the corpus currency and its known-partiality
 * caveats, for the right rail's data-source block.
 *
 * Anonymous, because the facade's own health endpoint is: this returns a
 * statement about a public register's coverage and no tenant data. It is also
 * on every page now, so it must not need a session on the one public route.
 *
 * Sourced from the registry rather than written into the app. The UK009 figure
 * moves when the baseline ingest lands, and a number typed into a component
 * would keep asserting 72% long after it stopped being true.
 */
export async function GET() {
  try {
    const h = await health('gb');
    return NextResponse.json({ currencyDate: h.currencyDate, coverage: h.coverage, reachable: h.baseXReachable !== false });
  } catch (e) {
    // The rail is furniture; it must not break a page because a facade is down.
    if (e instanceof FacadeError) {
      return NextResponse.json({ currencyDate: null, coverage: null, reachable: false }, { status: 200 });
    }
    throw e;
  }
}
