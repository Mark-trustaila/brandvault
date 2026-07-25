import type { Trademark as PrismaTrademark } from '@prisma/client';
import type { Obligation, Trademark } from '../types/trademark';
import { prisma } from './db';
import { getObligationsForTrademark } from './utils';
import { isLiveStatus, sameDay } from './reconciliation';

type MarkForRecalc = Pick<
  PrismaTrademark,
  'id' | 'registryName' | 'filingDate' | 'registrationDate' | 'expiryDate' | 'status'
>;

/**
 * Reconcile the calculated renewal series against the registry's expiry date.
 *
 * The engine itself is untouched (preserved code): this shapes what the engine
 * returned, it does not change how the engine derives anything.
 *
 * Two adjustments, both driven only by source agreement:
 *
 *  1. Liveness guard. A calculated renewal already in the past, on a live mark
 *     the registry says expires in the future, is drift rather than a missed
 *     obligation. It is dropped instead of being persisted as an overdue row.
 *  2. Registry row. When the registry expiry is in the future and no calculated
 *     renewal lands on that day, a renewal row is added on the registry date.
 *     Existing calculated rows are kept, so the later renewals in the series
 *     survive and the EARLIEST future row is the governing one. That is what
 *     makes "the earlier future date governs" hold for the alert engine without
 *     the alert engine needing to know reconciliation exists.
 *
 * Sources agreeing produces exactly the rows it produced before this change.
 */
export function reconcileObligations(
  obligations: Obligation[],
  expiryDate: Date | null,
  status: string,
  now: Date
): Obligation[] {
  const concrete = obligations.filter((o) => !o.uncertain && o.dueDate);
  if (!expiryDate) return concrete;

  const live = isLiveStatus(status);
  const registryFuture = expiryDate > now;

  // 1. Liveness guard.
  const kept = concrete.filter((o) => {
    if (o.type !== 'Renewal') return true;
    const past = (o.dueDate as Date) <= now;
    return !(past && live && registryFuture);
  });

  // 2. Registry row, when nothing calculated already lands on that day.
  if (registryFuture) {
    const alreadyThere = kept.some(
      (o) => o.type === 'Renewal' && sameDay(o.dueDate as Date, expiryDate)
    );
    if (!alreadyThere) {
      // Window start mirrors the engine's own early-window span for this mark,
      // taken from its nearest renewal so the registry row is not given a
      // window the registry's rules would not give it.
      const template = kept.find((o) => o.type === 'Renewal' && o.windowStart);
      const spanMs = template
        ? (template.dueDate as Date).getTime() - (template.windowStart as Date).getTime()
        : 0;
      kept.push({
        type: 'Renewal',
        desc: 'Renewal',
        dueDate: expiryDate,
        windowStart: new Date(expiryDate.getTime() - spanMs),
        daysUntil: Math.floor((expiryDate.getTime() - now.getTime()) / 86_400_000),
        critical: true,
        actionable: false,
        overdue: false,
        inWindow: false,
        uncertain: false,
      } as Obligation);
    }
  }

  return kept;
}

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
