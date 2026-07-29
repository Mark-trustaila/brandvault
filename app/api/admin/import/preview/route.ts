import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../../lib/tenant';
import { isPlatformAdmin } from '../../../../../lib/authz';
import { FacadeError, CapExceededError } from '../../../../../lib/registry-facade';
import { prepareImport, ImportAbortError } from '../../../../../lib/import-portfolio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/admin/import/preview — platform-admin only. Reads current state and
// the facade and returns predicted counts + plan + a sample. NO write.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !(await isPlatformAdmin(user.id))) {
    return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const companySlug = typeof body?.companySlug === 'string' ? body.companySlug : '';
  const ownerStrings = Array.isArray(body?.ownerStrings) ? body.ownerStrings.filter((s: unknown) => typeof s === 'string') : [];
  const pruneAbsent = body?.pruneAbsent === true;
  if (!companySlug || ownerStrings.length < 1) {
    return NextResponse.json({ error: 'companySlug and at least one ownerString are required' }, { status: 400 });
  }

  try {
    const p = await prepareImport({ companySlug, ownerStrings, pruneAbsent });
    return NextResponse.json({
      companyId: p.companyId,
      registryName: p.registryName,
      currencyDate: p.currencyDate,
      coverage: p.snapshot.coverage,
      predicted: p.predicted,
      plan: { toInsert: p.plan.toInsert, toUpdate: p.plan.toUpdate, staleCount: p.plan.stale.length, stale: p.plan.stale.slice(0, 50) },
      byStatus: tally(p.mapped.map((m) => m.registryStatusRaw)),
      bySeries: tally(p.mapped.map((m) => m.seriesPrefix)),
      sample: p.mapped.slice(0, 12).map((m) => ({
        applicationNumber: m.applicationNumber,
        markText: m.markText,
        status: m.status,
        registryStatusRaw: m.registryStatusRaw,
        seriesPrefix: m.seriesPrefix,
      })),
    });
  } catch (e) {
    if (e instanceof ImportAbortError) return NextResponse.json({ error: e.reason, code: 'IMPORT_ABORT' }, { status: 400 });
    if (e instanceof CapExceededError) {
      return NextResponse.json({ error: e.message, code: 'CAP_EXCEEDED', matchedDistinctMarks: e.matchedDistinctMarks, cap: e.cap, ownerBreakdown: e.ownerBreakdown }, { status: 413 });
    }
    if (e instanceof FacadeError) return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    throw e;
  }
}

function tally(xs: string[]): Record<string, number> {
  return xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
}
