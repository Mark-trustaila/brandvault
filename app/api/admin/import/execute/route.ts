import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requirePlatformAdmin } from '../../../../../lib/authz';
import { writeAudit } from '../../../../../lib/audit';
import { FacadeError, CapExceededError } from '../../../../../lib/registry-facade';
import { prepareImport, commitImport, ImportAbortError, ImportVerificationError } from '../../../../../lib/import-portfolio';
import { rateLimit, IMPORT_LIMIT, startImportEvent, finishImportEvent } from '../../../../../lib/import-events';
import { waitUntil } from '@vercel/functions';
import { emitImportCompleted } from '../../../../../lib/ailaCore';
import { backfillCompany } from '../../../../../lib/aila-backfill';

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
    // AiLA Core: emitted only on a verified commit, with the counts the import
    // already reports. snapshotRef is the portfolio_imports row — the durable
    // handle for this import's snapshot. waitUntil keeps the retry chain out of
    // the operator's response time (see lib/alerts.ts).
    //
    // The import is what populates a concierge-onboarded tenant, so it is also
    // where AiLA gets seeded: the backfill follows, replaying the deadlines this
    // import just created so the customer's AiLA dashboard is populated now
    // rather than whenever a threshold first trips. Chained rather than
    // dispatched separately so import.completed lands first — the arrival order
    // reads as "portfolio imported, then here is what is due". Emission only; it
    // touches no alert flag and sends no Slack (see lib/aila-backfill.ts).
    waitUntil(
      emitImportCompleted({
        companyId: prepared.companyId,
        counts: result.actual as unknown as Record<string, number>,
        snapshotRef: importId,
      })
        .then(() => backfillCompany({ companyId: prepared.companyId }))
        // The import is committed and reported by the time this runs. A backfill
        // that fails (Core down, a DB blip on the read) must stay a logged
        // nuisance the operator can re-run from the admin route, never something
        // that surfaces as a failed import.
        .catch((e) => console.error(`[aila-backfill] company ${prepared.companyId} after import ${importId}:`, e)),
    );
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
