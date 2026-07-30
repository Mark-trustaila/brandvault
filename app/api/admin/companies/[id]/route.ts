import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../../../lib/db';
import { requirePlatformAdmin } from '../../../../../lib/authz';
import { writeAudit } from '../../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

// PATCH /api/admin/companies/:id — platform admin links (or unlinks) a company
// to a Clerk organization. Once linked, that org's members' logins resolve to
// this company automatically (see lib/tenant.resolveCompany). Audited.
export async function PATCH(req: Request, { params }: Params) {
  const user = await requirePlatformAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const raw = body?.clerkOrgId;
  const clerkOrgId = raw === null ? null : typeof raw === 'string' ? raw.trim() || null : undefined;
  if (clerkOrgId === undefined) {
    return NextResponse.json({ error: 'clerkOrgId is required (string to link, null to unlink)' }, { status: 400 });
  }

  try {
    const company = await prisma.company.update({ where: { id: params.id }, data: { clerkOrgId } });
    await writeAudit({
      companyId: company.id,
      userId: user.id,
      isPlatformAdmin: true,
      action: clerkOrgId ? 'company.link_org' : 'company.unlink_org',
      entityType: 'Company',
      entityId: company.id,
      reason: typeof body?.reason === 'string' ? body.reason : 'onboarding link',
      detail: { clerkOrgId },
    });
    return NextResponse.json({ id: company.id, name: company.name, clerkOrgId: company.clerkOrgId });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') return NextResponse.json({ error: 'That Clerk org is already linked to another company' }, { status: 409 });
      if (e.code === 'P2025') return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }
    throw e;
  }
}

// DELETE /api/admin/companies/:id — platform-admin only. Removes a company
// husk (e.g. a concierge test company). Refuses unless it holds NOTHING but its
// own audit rows: zero marks, users, families, alert preference, inbound emails,
// notifications, bree query logs, approvals, watch notices and portfolio
// imports. A linked Clerk org is refused unless ?force=true. The company's own
// audit rows are tolerated and cascade away with it (AuditLog.companyId is a
// required, cascading FK, so a deletion audit can't outlive its company).
export async function DELETE(req: Request, { params }: Params) {
  const user = await requirePlatformAdmin();
  if (!user) return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });

  const force = new URL(req.url).searchParams.get('force') === 'true';

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, clerkOrgId: true,
      alertPreference: { select: { id: true } },
      _count: {
        select: {
          trademarks: true, users: true, families: true, inboundEmails: true,
          notifications: true, breeQueryLogs: true, approvals: true,
          watchNotices: true, portfolioImports: true, auditLogs: true,
        },
      },
    },
  });
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

  const c = company._count;
  const blockers: string[] = [];
  if (c.trademarks) blockers.push(`${c.trademarks} mark(s)`);
  if (c.users) blockers.push(`${c.users} user(s)`);
  if (c.families) blockers.push(`${c.families} family/families`);
  if (company.alertPreference) blockers.push('an alert preference');
  if (c.inboundEmails) blockers.push(`${c.inboundEmails} inbound email(s)`);
  if (c.notifications) blockers.push(`${c.notifications} notification(s)`);
  if (c.breeQueryLogs) blockers.push(`${c.breeQueryLogs} bree query log(s)`);
  if (c.approvals) blockers.push(`${c.approvals} approval(s)`);
  if (c.watchNotices) blockers.push(`${c.watchNotices} watch notice(s)`);
  if (c.portfolioImports) blockers.push(`${c.portfolioImports} portfolio import(s)`);
  if (blockers.length) {
    return NextResponse.json(
      { error: `Refusing to delete '${company.name}' — it holds ${blockers.join(', ')}. Only its own audit rows are tolerated.`, blockers },
      { status: 409 },
    );
  }
  if (company.clerkOrgId && !force) {
    return NextResponse.json(
      { error: `'${company.name}' is linked to a Clerk organisation — unlink it first, or confirm with force.`, code: 'LINKED_ORG' },
      { status: 409 },
    );
  }

  // Cascade removes the company and its own audit rows (the only tolerated relation).
  await prisma.company.delete({ where: { id: company.id } });
  return NextResponse.json({ deleted: true, id: company.id, name: company.name, auditRowsRemoved: c.auditLogs });
}
