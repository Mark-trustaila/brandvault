import { NextResponse } from 'next/server';
import { getActingCompany } from '../../../../lib/authz';
import { getSearch, SmartSearchError } from '../../../../lib/smart-search';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/smart-search/{id} — one poll of the facade (§3.2).
 *
 * The facade owns the loop against LawPanel; BrandVault polls the facade and no
 * request thread ever blocks on an external job. This route is a pass-through
 * that adds authentication and nothing else: `status: "failed"` is relayed with
 * its reason as a 200, because a search that ran and did not succeed is a
 * result, not an error (§3.3). Only the facade being unreachable is a 502.
 *
 * A read, so an ordinary member sees results. Nothing is stored: the facade
 * holds the search, and BrandVault holds an id for as long as the tab is open.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const company = await getActingCompany(req);
  if (!company) return NextResponse.json({ error: 'No active organization' }, { status: 403 });

  try {
    return NextResponse.json(await getSearch(params.id));
  } catch (e) {
    if (e instanceof SmartSearchError) {
      const status = e.httpStatus === 404 ? 404 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }
}
