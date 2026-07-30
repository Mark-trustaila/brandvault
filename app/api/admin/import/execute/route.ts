import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requirePlatformAdmin } from '../../../../../lib/authz';
import { writeAudit } from '../../../../../lib/audit';
import { FacadeError, CapExceededError } from '../../../../../lib/registry-facade';
import { prepareImport, commitImport, ImportAbortError, ImportVerificationError } from '../../../../../lib/import-portfolio';
import { rateLimit, IMPORT_LIMIT, startImportEvent, finishImportEvent } from '../../../../../lib/import-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/admin/import/execute — platform-admin only. Runs the import in one
// idempotent transaction with all loader gates. Persists the snapshot BEFORE
// the write and records the outcome to portfolio_imports. Rate limited per org
// (spec: 3/day).
export async function POST(req: Request) {
  const user = await requirePlatformAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const companySlug = typeof body?.companySlug === 'string' ? body.companySlug : '';
  const ownerStrings = Array.isArray(body?.ownerStrings) ? body.ownerStrings.filter((s: unknown) => typeof s === 'string') : [];
  // Mark-level curation: the exact application numbers the operator ticked.
  const selectedApplicationNumbers = Array.isArray(body?.selectedApplicationNumbers)
    ? body.selectedApplicationNumbers.filter((s: unknown) => typeof s === 'string')
    : undefined;
  const pruneAbsent = body?.pruneAbsent === true;
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!companySlug || ownerStrings.length < 1) {
    return NextResponse.json({ error: 'companySlug and at least one ownerString are required' }, { status: 400 });
  }
  if (!reason) return NextResponse.json({ error: 'reason is required for an import' }, { status: 400 });

  const rl = await rateLimit(`import:${companySlug}`, IMPORT_LIMIT.max, IMPORT_LIMIT.windowMs, new Date());
  if (!rl.allowed) {
    return NextResponse.json({ error: `Import limit reached for this company; resets ${rl.resetAt.toISOString()}` }, { status: 429 });
  }

  let prepared;
  try {
    prepared = await prepareImport({ companySlug, ownerStrings, pruneAbsent, selectedApplicationNumbers });
  } catch (e) {
    if (e instanceof ImportAbortError) return NextResponse.json({ error: e.reason, code: 'IMPORT_ABORT' }, { status: 400 });
    if (e instanceof CapExceededError) {
      return NextResponse.json({ error: e.message, code: 'CAP_EXCEEDED', matchedDistinctMarks: e.matchedDistinctMarks, cap: e.cap }, { status: 413 });
    }
    if (e instanceof FacadeError) return NextResponse.json({ error: e.message, code: e.code }, { status: 502 });
    throw e;
  }

  // Persist snapshot BEFORE committing — rollback material must exist first.
  const importId = await startImportEvent(prepared, user.id);

  try {
    const result = await commitImport(prepared);
    await finishImportEvent(importId, 'committed', result.actual);
    await writeAudit({
      companyId: prepared.companyId,
      userId: user.id,
      isPlatformAdmin: true,
      action: 'portfolio.import',
      entityType: 'Company',
      entityId: prepared.companyId,
      reason,
      detail: { importId, ownerStrings, predicted: prepared.predicted, actual: result.actual, plan: prepared.plan } as unknown as Prisma.InputJsonValue,
    });
    return NextResponse.json({ importId, ...result });
  } catch (e) {
    const rolledBack = e instanceof ImportVerificationError;
    await finishImportEvent(importId, rolledBack ? 'rolled_back' : 'failed');
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'import failed', code: rolledBack ? 'ROLLED_BACK' : 'FAILED', importId },
      { status: 500 },
    );
  }
}
