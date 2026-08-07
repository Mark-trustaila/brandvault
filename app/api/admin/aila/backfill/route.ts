import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requirePlatformAdmin } from '../../../../../lib/authz';
import { writeAudit } from '../../../../../lib/audit';
import { backfillCompany } from '../../../../../lib/aila-backfill';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// A backfill emits sequentially with a retrying emitter; a large limit against a
// slow Core needs more than the default function budget.
export const maxDuration = 300;

// Recognition is org-independent (see lib/authz.requirePlatformAdmin), matching
// the other admin routes: a platform admin reaches this whether or not their
// active org is linked. This route resolves its own company explicitly and
// establishes no acting company.

/**
 * POST /api/admin/aila/backfill — platform-admin only.
 *
 * Replays a company's next N upcoming deadlines to AiLA Core as
 * `deadline.approaching`, so a new customer's AiLA dashboard is populated on day
 * one instead of waiting for a 180/90/30 threshold to trip. Emission only: no
 * alert flags, no notifications, no Slack (see lib/aila-backfill.ts).
 *
 * Body:
 *   companySlug | companyId  one is required — the company to backfill
 *   limit                    optional; default AILA_BACKFILL_LIMIT, else 25
 *   dryRun                   optional; true returns the plan without emitting
 *   reason                   optional; recorded on the audit entry
 *
 * Deliberately requires an explicit company. There is no "all companies" form:
 * a blanket replay can reopen matters already closed in AiLA, so the blast
 * radius of a mistyped call is one tenant.
 */
export async function POST(req: Request) {
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const companySlug = typeof body?.companySlug === 'string' ? body.companySlug.trim() : '';
  const companyId = typeof body?.companyId === 'string' ? body.companyId.trim() : '';
  if (!companySlug && !companyId) {
    return NextResponse.json({ error: 'companySlug or companyId is required' }, { status: 400 });
  }

  // A caller who names a limit gets told when it is nonsense rather than
  // silently falling back to the default — the env/default fallback in
  // resolveBackfillLimit exists for an absent limit, not a mistyped one. A limit
  // above the cap is still honoured, clamped, since that asks for more than the
  // maximum rather than for something meaningless.
  if (body?.limit !== undefined && !(Number.isInteger(body.limit) && body.limit > 0)) {
    return NextResponse.json(
      { error: 'limit must be a positive whole number' },
      { status: 400 },
    );
  }

  const company = await prisma.company.findFirst({
    where: companyId ? { id: companyId } : { slug: companySlug },
    select: { id: true, name: true, slug: true },
  });
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const dryRun = body?.dryRun === true;
  const result = await backfillCompany({ companyId: company.id, limit: body?.limit, dryRun });

  // A dry run reads and emits nothing, so there is nothing to record. Auditing
  // it would put an entry in the customer's activity feed for a question.
  if (!dryRun) {
    await writeAudit({
      companyId: company.id,
      userId: user.id,
      isPlatformAdmin: true,
      action: 'aila.deadline_backfill',
      entityType: 'Company',
      entityId: company.id,
      reason: typeof body?.reason === 'string' ? body.reason : 'AiLA dashboard backfill',
      detail: { limit: result.limit, emitted: result.emitted, failed: result.failed },
    });
  }

  // A run where Core accepted nothing is not a success, and must not answer 200
  // — the caller was previously told `emitted: 25` while Core rejected all 25.
  // 502: BrandVault did its part and the upstream refused. A partial success
  // stays 200 and is visible in `failed`/`failures`.
  const nothingLanded = !dryRun && result.planned > 0 && result.emitted === 0;

  return NextResponse.json(
    {
      company: { id: company.id, name: company.name, slug: company.slug },
      limit: result.limit,
      planned: result.planned,
      emitted: result.emitted,
      failed: result.failed,
      failures: result.failures,
      dryRun: result.dryRun,
      notices: result.notices,
      ...(nothingLanded
        ? { error: `AiLA Core accepted none of ${result.planned} notices — see failures` }
        : {}),
    },
    { status: nothingLanded ? 502 : 200 },
  );
}
