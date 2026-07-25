import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { getActingCompany } from '../../../lib/authz';

// Reads tenant data at request time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/watch-notices?trademarkId=... — third-party filing notices for the
 * acting company, optionally for one mark. Company-scoped: a notice belonging
 * to another tenant is never returned.
 *
 * Read-only. Notices are created by the inbound-email path alone.
 */
export async function GET(req: Request) {
  const company = await getActingCompany(req);
  if (!company) return NextResponse.json({ notices: [] });

  const trademarkId = new URL(req.url).searchParams.get('trademarkId');
  const notices = await prisma.watchNotice.findMany({
    where: { companyId: company.id, ...(trademarkId ? { trademarkId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      trademarkId: true,
      thirdPartyMarkText: true,
      thirdPartyApplicationNumber: true,
      thirdPartyClasses: true,
      oppositionDeadline: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ notices });
}
