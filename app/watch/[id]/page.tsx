import { notFound } from 'next/navigation';
import { prisma } from '../../../lib/db';
import { getCurrentCompany } from '../../../lib/tenant';
import ComparisonView from '../../../components/watch/ComparisonView';

// Reads the tenant's data at request time — never statically evaluated.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Side-by-side comparison for a third-party filing notice, opened from the
 * "See in app" deep link in Bree's alert.
 *
 * Company-scoped: the notice is only served to the acting company that owns it.
 * A notice belonging to another tenant is a 404, not a 403, so the route does
 * not confirm that an id exists to someone who should not see it.
 */
export default async function WatchNoticePage({ params }: { params: { id: string } }) {
  const company = await getCurrentCompany();
  if (!company) notFound();

  const notice = await prisma.watchNotice.findFirst({
    where: { id: params.id, companyId: company.id },
    include: {
      trademark: { include: { goodsServices: true } },
    },
  });
  if (!notice) notFound();

  const ourClasses = Array.from(
    new Set(notice.trademark.goodsServices.map((g) => g.classNumber))
  ).sort((a, b) => a - b);

  // Stored as filed. Coerced here only because the column is JSON.
  const theirClasses = Array.isArray(notice.thirdPartyClasses)
    ? (notice.thirdPartyClasses as unknown[]).map(Number).filter((n) => Number.isFinite(n))
    : [];

  return (
    <ComparisonView
      ours={{
        markText: notice.trademark.markText,
        applicationNumber: notice.trademark.applicationNumber ?? 'No number',
        classes: ourClasses,
        filingDate: notice.trademark.filingDate?.toISOString() ?? null,
        registry: notice.trademark.registryName,
      }}
      theirs={{
        markText: notice.thirdPartyMarkText,
        applicationNumber: notice.thirdPartyApplicationNumber,
        classes: theirClasses,
        filingDate: notice.filingDate?.toISOString() ?? null,
        registry: notice.trademark.registryName,
      }}
      oppositionDeadline={notice.oppositionDeadline?.toISOString() ?? null}
    />
  );
}
