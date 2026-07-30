import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../../lib/authz';
import { FacadeError, CapExceededError } from '../../../../../lib/registry-facade';
import { prepareImport, ImportAbortError } from '../../../../../lib/import-portfolio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/admin/import/preview — platform-admin only. Returns the FULL in-scope
// mark list for the ticked owners so the preview becomes the mark-level curation
// surface (grouped client-side by owner string). Reads only; NO write.
export async function POST(req: Request) {
  const user = await requirePlatformAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const companySlug = typeof body?.companySlug === 'string' ? body.companySlug : '';
  const ownerStrings = Array.isArray(body?.ownerStrings) ? body.ownerStrings.filter((s: unknown) => typeof s === 'string') : [];
  if (!companySlug || ownerStrings.length < 1) {
    return NextResponse.json({ error: 'companySlug and at least one ownerString are required' }, { status: 400 });
  }

  try {
    // No selection here — preview lists the full registry result; curation
    // happens client-side and the chosen subset is sent to /execute.
    const p = await prepareImport({ companySlug, ownerStrings });
    const existing = new Set(p.existingAppNumbers);
    return NextResponse.json({
      companyId: p.companyId,
      registryName: p.registryName,
      currencyDate: p.currencyDate,
      coverage: p.snapshot.coverage,
      totalInScope: p.inScope.length,
      staleCount: p.plan.stale.length, // absent-from-registry marks (informational)
      marks: p.inScope.map((m) => ({
        applicationNumber: m.applicationNumber,
        ownerString: m.ownerName ?? '(no owner)', // group key — verbatim, unnormalised (exact strings are match keys)
        markText: m.markText, // device convention already applied by the transform
        status: m.registryStatusRaw, // verbatim registry status
        classes: Array.from(new Set(m.goodsServices.map((g) => g.classNumber))).sort((a, b) => a - b),
        seriesPrefix: m.seriesPrefix,
        goodsServices: m.goodsServices.length,
        deadlines: m.deadlines.length,
        existing: existing.has(m.applicationNumber), // would update in place vs insert
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
