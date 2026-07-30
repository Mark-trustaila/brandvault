import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { requirePlatformAdmin } from '../../../../../lib/authz';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/admin/import/history?company=<slug> — platform-admin only. Import
// history for a company (no snapshot payload — that's fetched on demand for
// rollback).
export async function GET(req: Request) {
  const user = await requirePlatformAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });
  }
  const slug = new URL(req.url).searchParams.get('company') ?? '';
  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 });

  const rows = await prisma.portfolioImport.findMany({
    where: { companyId: company.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true, registryName: true, ownerStrings: true, currencyDate: true,
      status: true, predicted: true, actual: true, plan: true, pruned: true,
      createdBy: true, createdAt: true,
    },
  });
  return NextResponse.json({ imports: rows });
}
