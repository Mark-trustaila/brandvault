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
