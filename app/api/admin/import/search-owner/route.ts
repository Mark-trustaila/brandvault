import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../../lib/authz';
import { searchByOwner, FacadeError } from '../../../../../lib/registry-facade';
import { rateLimit, SEARCH_LIMIT } from '../../../../../lib/import-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/admin/import/search-owner — platform-admin only. Proprietor search
// (the checkbox step). Rate limited per org (spec: 10/hour).
export async function POST(req: Request) {
  const user = await requirePlatformAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  if (query.length < 2 || query.length > 120) {
    return NextResponse.json({ error: 'query must be 2–120 characters' }, { status: 400 });
  }

  const rl = await rateLimit(`search:${user.companyId}`, SEARCH_LIMIT.max, SEARCH_LIMIT.windowMs, new Date());
  if (!rl.allowed) {
    return NextResponse.json({ error: `Search limit reached; resets ${rl.resetAt.toISOString()}` }, { status: 429 });
  }

  try {
    return NextResponse.json(await searchByOwner(query));
  } catch (e) {
    if (e instanceof FacadeError) return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    throw e;
  }
}
