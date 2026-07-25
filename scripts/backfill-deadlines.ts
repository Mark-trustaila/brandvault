/**
 * Recalculate + persist deadlines (and needsData) for every existing mark.
 * Run once after the deadline-persistence change, and on any DB the app deploys
 * against (deadlines are computed on create/edit going forward).
 *   npx tsx scripts/backfill-deadlines.ts
 */
import { prisma } from '../lib/db';
import { recalcDeadlines } from '../lib/deadlines';

async function main() {
  const marks = await prisma.trademark.findMany({
    select: {
      id: true, registryName: true, filingDate: true, registrationDate: true,
      // Reconciliation inputs: the registry expiry and the liveness guard.
      expiryDate: true, status: true,
    },
  });
  let deadlines = 0;
  let needsData = 0;
  for (const m of marks) {
    const r = await recalcDeadlines(m);
    deadlines += r.persisted;
    if (r.needsData) needsData += 1;
  }
  console.log(`recalced ${marks.length} marks — ${deadlines} deadlines persisted, ${needsData} flagged needs-data`);
  console.log(`deadlines table now holds ${await prisma.deadline.count()} rows`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
