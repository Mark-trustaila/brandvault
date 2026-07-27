/**
 * Read queries backing Bree's slash commands. Return the plain shapes the
 * formatters in bree-messages.ts expect.
 */
import { prisma } from './db';
import { orderByGoverningDeadline, soonestRank } from './bree-ordering';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysFrom = (d: Date, now: Date) => Math.floor((d.getTime() - now.getTime()) / 86_400_000);

export async function portfolioSummary(companyId: string, now = new Date()) {
  const in12mo = new Date(now.getTime());
  in12mo.setUTCFullYear(in12mo.getUTCFullYear() + 1);
  const [total, registered, pending, published, needsAttention] = await Promise.all([
    prisma.trademark.count({ where: { companyId } }),
    prisma.trademark.count({ where: { companyId, status: 'Registered' } }),
    prisma.trademark.count({ where: { companyId, status: 'Pending' } }),
    prisma.trademark.count({ where: { companyId, status: 'Published' } }),
    prisma.trademark.count({ where: { companyId, deadlines: { some: { dueDate: { gte: now, lte: in12mo } } } } }),
  ]);
  return { total, registered, pending, published, needsAttention };
}

export async function upcomingRenewals(companyId: string, limit = 5, now = new Date()) {
  const rows = await prisma.deadline.findMany({
    where: { trademark: { companyId }, dueDate: { gte: now } },
    include: { trademark: true },
    orderBy: { dueDate: 'asc' },
    take: limit,
  });
  // The SQL already returns these soonest-first. Sorting through the shared
  // helper anyway so the ordering rule has one definition rather than relying
  // on each query's ORDER BY staying correct independently.
  return orderByGoverningDeadline(
    rows.map((d) => ({
      markText: d.trademark.markText,
      registry: d.trademark.registryName,
      dueDate: isoDay(d.dueDate),
      daysRemaining: daysFrom(d.dueDate, now),
    })),
    (r) => r.daysRemaining
  );
}

export type MarkStatusRow = {
  registry: string;
  status: string;
  nextDeadline?: { type: string; dueDate: string; daysRemaining: number };
};
export type MarkStatusGroup = { markText: string; rows: MarkStatusRow[] };

/**
 * All marks matching `query`, grouped by mark name with one row per registry.
 * A brand like ASOS is registered separately in UKIPO / EUIPO / USPTO etc; the
 * user wants to see every registration, not one arbitrary hit.
 *
 * Matching is case-insensitive (MySQL collation-independent). An exact name
 * match wins — "asos" shows the ASOS registrations, not ASOS.COM / ASOS EDITION;
 * only when nothing matches exactly do we fall back to substring matches
 * (which may span several names, each its own group).
 */
export async function markStatus(companyId: string, query: string, now = new Date()): Promise<MarkStatusGroup[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const marks = await prisma.trademark.findMany({
    where: { companyId },
    orderBy: [{ markText: 'asc' }, { registryName: 'asc' }],
  });
  const exact = marks.filter((m) => m.markText.toLowerCase() === q);
  const matched = exact.length ? exact : marks.filter((m) => m.markText.toLowerCase().includes(q));
  if (!matched.length) return [];

  // Earliest upcoming deadline per matched mark, in one query.
  const deadlines = await prisma.deadline.findMany({
    where: { trademarkId: { in: matched.map((m) => m.id) }, dueDate: { gte: now } },
    orderBy: { dueDate: 'asc' },
  });
  const nextByMark = new Map<string, (typeof deadlines)[number]>();
  for (const d of deadlines) if (!nextByMark.has(d.trademarkId)) nextByMark.set(d.trademarkId, d);

  const groups = new Map<string, MarkStatusGroup>();
  for (const m of matched) {
    if (!groups.has(m.markText)) groups.set(m.markText, { markText: m.markText, rows: [] });
    const next = nextByMark.get(m.id);
    groups.get(m.markText)!.rows.push({
      registry: m.registryName,
      status: m.status as string,
      nextDeadline: next ? { type: next.type, dueDate: isoDay(next.dueDate), daysRemaining: daysFrom(next.dueDate, now) } : undefined,
    });
  }

  // Order by urgency, not by registry name. The DB order above is retained only
  // as the tie-break: rights sharing a deadline stay registry-alphabetical.
  // Rows are ordered within each mark, then the marks themselves by their most
  // urgent right, so a multi-name match cannot bury an urgent right either.
  const days = (r: MarkStatusRow) => r.nextDeadline?.daysRemaining;
  const ordered = Array.from(groups.values()).map((g) => ({
    ...g,
    rows: orderByGoverningDeadline(g.rows, days),
  }));
  return orderByGoverningDeadline(ordered, (g) => soonestRank(g.rows, days));
}
