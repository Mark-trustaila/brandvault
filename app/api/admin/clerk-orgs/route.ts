import { NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '../../../../lib/db';
import { requirePlatformAdmin } from '../../../../lib/authz';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/admin/clerk-orgs — platform-admin only. Clerk organizations to link a
// (concierge-created) company to, with whether each is already linked.
export async function GET() {
  const user = await requirePlatformAdmin();
  if (!user) {
    return NextResponse.json({ error: 'Platform admin only' }, { status: 403 });
  }

  const list = await (await clerkClient()).organizations.getOrganizationList({ limit: 100 });
  const linked = await prisma.company.findMany({
    where: { clerkOrgId: { not: null } },
    select: { clerkOrgId: true, name: true },
  });
  const linkedTo = new Map(linked.map((c) => [c.clerkOrgId, c.name]));

  return NextResponse.json({
    orgs: list.data.map((o) => ({ id: o.id, name: o.name, linkedTo: linkedTo.get(o.id) ?? null })),
  });
}
