import type { Trademark as PrismaTrademark } from '@prisma/client';
import type { Obligation, Trademark } from '../types/trademark';
import { prisma } from './db';
import { getObligationsForTrademark } from './utils';
import { sameDay, reconcileObligations } from './reconciliation';

// reconcileObligations lives in lib/reconciliation.ts (pure, no DB) so the GB
// import transform can reconcile before persisting without pulling a Prisma
// client into a side-effect-free module. Re-exported here because this was its
// home and every existing caller imports it from this path.
export { reconcileObligations };

type MarkForRecalc = Pick<
  PrismaTrademark,
  'id' | 'registryName' | 'filingDate' | 'registrationDate' | 'expiryDate' | 'status'
>;


/**
 * Recalculate a mark's deadlines with the config-driven renewal engine and
 * persist them to the Deadlines table (replace-all). Sets the mark's needsData
 * flag when a required date is missing (the engine returns an uncertain
 * obligation, which can't be persisted as a dated deadline).
 *
 * The persisted rows are reconciled against the registry expiry date first.
 * See lib/reconciliation.ts for the invariant this upholds.
 */
export async function recalcDeadlines(
  mark: MarkForRecalc,
  now = new Date()
): Promise<{ persisted: number; needsData: boolean }> {
  const shaped = {
    registry_name: mark.registryName,
    filing_date: mark.filingDate ? mark.filingDate.toISOString() : undefined,
    registration_date: mark.registrationDate ? mark.registrationDate.toISOString() : undefined,
  } as Trademark;

  const obligations = getObligationsForTrademark(shaped);
  const needsData = obligations.some((o) => o.uncertain);
  const concrete = reconcileObligations(obligations, mark.expiryDate, mark.status, now);
  // The engine's own next future renewal, before reconciliation added anything.
  const nextCalculated =
    obligations
      .filter((o) => o.type === 'Renewal' && !o.uncertain && o.dueDate && (o.dueDate as Date) > now)
      .map((o) => o.dueDate as Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  await prisma.$transaction([
    prisma.deadline.deleteMany({ where: { trademarkId: mark.id } }),
    ...(concrete.length
      ? [
          prisma.deadline.createMany({
            data: concrete.map((o) => ({
              trademarkId: mark.id,
              type: o.type,
              description: o.desc,
              dueDate: o.dueDate as Date,
              windowStart: (o.windowStart ?? o.dueDate) as Date,
              // Provenance: which date the registry stated, which the engine
              // derived, and whether they disagreed when this row was written.
              ...(o.type === 'Renewal'
                ? {
                    registryExpiryDate: mark.expiryDate,
                    calculatedDueDate: nextCalculated,
                    datesDiffer:
                      mark.expiryDate !== null &&
                      nextCalculated !== null &&
                      !sameDay(mark.expiryDate, nextCalculated),
                  }
                : {}),
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.trademark.update({ where: { id: mark.id }, data: { needsData } }),
  ]);

  return { persisted: concrete.length, needsData };
}
