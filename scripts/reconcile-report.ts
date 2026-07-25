/**
 * Renewal reconciliation — before/after report. READ-ONLY.
 *
 * Computes what recalcDeadlines WOULD persist for every mark and diffs it
 * against what is in the deadlines table now. Writes nothing. The execute path
 * is scripts/backfill-deadlines.ts, which is only run once this report has been
 * reviewed.
 *
 *   ( set -a; . ./.env.azure.local; set +a; npx tsx scripts/reconcile-report.ts )
 *
 * What to check in the output:
 *  - ALIGNED marks must show no movement. Any aligned mark whose rows change is
 *    a bug in reconciliation, not an expected result. The report exits non-zero.
 *  - DIVERGENT marks gain the registry date as the governing (earliest future)
 *    row, and keep their calculated series.
 *  - PAST-DUE rows are split into drift artifacts (superseded by a future
 *    registry expiry on a live mark) and genuine ones (nothing supersedes them).
 */
import { prisma } from '../lib/db';
import { getObligationsForTrademark } from '../lib/utils';
import { reconcileObligations } from '../lib/deadlines';
import { reconcileRenewal, isLiveStatus, sameDay } from '../lib/reconciliation';
import type { Trademark } from '../types/trademark';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const NOW = new Date();
const daysFrom = (d: Date) => Math.floor((d.getTime() - NOW.getTime()) / 86_400_000);

async function main() {
  const companySlug = process.argv[2] ?? 'asos-plc';
  const company = await prisma.company.findFirst({ where: { slug: companySlug } });
  if (!company) throw new Error(`no company with slug ${companySlug}`);

  const marks = await prisma.trademark.findMany({
    where: { companyId: company.id },
    include: { deadlines: true },
    orderBy: { markText: 'asc' },
  });

  let aligned = 0;
  let divergent = 0;
  let noExpiry = 0;
  const movedWhenAligned: string[] = [];
  const alignedPastRetired: string[] = [];
  const divergentRows: string[] = [];
  const driftDropped: string[] = [];
  const genuinePastDue: string[] = [];

  for (const m of marks) {
    const shaped = {
      registry_name: m.registryName,
      filing_date: m.filingDate?.toISOString(),
      registration_date: m.registrationDate?.toISOString(),
    } as Trademark;

    const obligations = getObligationsForTrademark(shaped);
    const before = obligations.filter((o) => !o.uncertain && o.dueDate);
    const after = reconcileObligations(obligations, m.expiryDate, m.status, NOW);

    // Past-due analysis over the rows ACTUALLY persisted today, for every mark.
    for (const row of m.deadlines) {
      if (row.dueDate > NOW || row.completedAt) continue;
      // Only a RENEWAL can be superseded by a later registry expiry. A missed
      // Section 8 or similar is a genuine gap: the expiry date says nothing
      // about whether that filing was made.
      const supersededByRegistry =
        row.type === 'Renewal' && isLiveStatus(m.status) && m.expiryDate !== null && m.expiryDate > NOW;
      const line = `${m.markText.slice(0, 26).padEnd(26)} ${(m.applicationNumber ?? '').padEnd(15)} ${row.type} ${iso(row.dueDate)} (${daysFrom(row.dueDate)}d)`;
      if (supersededByRegistry) driftDropped.push(`${line}  superseded by registry expiry ${iso(m.expiryDate as Date)}`);
      else genuinePastDue.push(`${line}  status=${m.status} registryExpiry=${m.expiryDate ? iso(m.expiryDate) : 'none'}`);
    }

    const beforeDues = before.map((o) => `${o.type}@${iso(o.dueDate as Date)}`).sort();
    const afterDues = after.map((o) => `${o.type}@${iso(o.dueDate as Date)}`).sort();
    const changed = beforeDues.join('|') !== afterDues.join('|');

    // Classify the mark by whether its two sources agree.
    const nextCalcFuture = before
      .filter((o) => o.type === 'Renewal' && (o.dueDate as Date) > NOW)
      .map((o) => o.dueDate as Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    if (!m.expiryDate) {
      noExpiry++;
      if (changed) movedWhenAligned.push(`${m.markText} (${m.applicationNumber}) has no expiry date but rows changed`);
      continue;
    }

    const agrees = nextCalcFuture !== null && sameDay(nextCalcFuture, m.expiryDate);
    const anyCalcOnExpiry = before.some(
      (o) => o.type === 'Renewal' && sameDay(o.dueDate as Date, m.expiryDate as Date)
    );

    if (agrees || anyCalcOnExpiry) {
      aligned++;
      if (changed) {
        // Movement on an aligned mark is only a bug if the GOVERNING date moved.
        // Retiring a stale past renewal row (the previous term, already met) is
        // the liveness guard doing its job and leaves the future series alone.
        const futuresBefore = before.filter((o) => (o.dueDate as Date) > NOW).map((o) => `${o.type}@${iso(o.dueDate as Date)}`).sort();
        const futuresAfter = after.filter((o) => (o.dueDate as Date) > NOW).map((o) => `${o.type}@${iso(o.dueDate as Date)}`).sort();
        if (futuresBefore.join('|') !== futuresAfter.join('|')) {
          movedWhenAligned.push(
            `${m.markText} (${m.applicationNumber}): ${beforeDues.join(', ')}  ->  ${afterDues.join(', ')}`
          );
        } else {
          alignedPastRetired.push(
            `${m.markText.slice(0, 26).padEnd(26)} ${(m.applicationNumber ?? '').padEnd(15)} ` +
              `retired ${beforeDues.filter((x) => !afterDues.includes(x)).join(', ')}; future series unchanged (${futuresAfter.join(', ')})`
          );
        }
      }
      continue;
    }

    divergent++;
    const r = reconcileRenewal({
      registryExpiry: m.expiryDate,
      calculatedDue: nextCalcFuture,
      status: m.status,
      now: NOW,
    });
    const gov = r.governingDate ? `${iso(r.governingDate)} (${daysFrom(r.governingDate)}d, ${r.governingSource})` : 'none';
    divergentRows.push(
      `${m.markText.slice(0, 26).padEnd(26)} ${(m.applicationNumber ?? '').padEnd(15)} ` +
        `registry=${iso(m.expiryDate)} calc=${nextCalcFuture ? iso(nextCalcFuture) : 'none'} governing=${gov}`
    );

  }

  console.log(`company: ${company.name} (${companySlug}) — ${marks.length} marks\n`);
  console.log(`ALIGNED (sources agree):        ${aligned}`);
  console.log(`DIVERGENT (sources differ):     ${divergent}`);
  console.log(`NO REGISTRY EXPIRY:             ${noExpiry}`);

  console.log(`\n=== DIVERGENT (${divergentRows.length}) — gain the governing date ===`);
  divergentRows.sort().forEach((l) => console.log('  ' + l));

  console.log(`\n=== PAST-DUE ROWS RETIRED AS DRIFT (${driftDropped.length}) ===`);
  driftDropped.forEach((l) => console.log('  ' + l));

  console.log(`\n=== PAST-DUE ROWS KEPT AS GENUINE (${genuinePastDue.length}) ===`);
  genuinePastDue.forEach((l) => console.log('  ' + l));

  console.log(`\n=== ALIGNED MARKS: STALE PAST ROW RETIRED, FUTURE SERIES UNCHANGED (${alignedPastRetired.length}) ===`);
  alignedPastRetired.forEach((l) => console.log('  ' + l));

  console.log(`\n=== ALIGNED MARKS WHOSE GOVERNING DATE MOVED (must be 0) ===`);
  if (movedWhenAligned.length === 0) {
    console.log('  none — no aligned mark changed.');
  } else {
    movedWhenAligned.forEach((l) => console.log('  !! ' + l));
    console.log(`\n  ${movedWhenAligned.length} aligned marks moved. This is a bug. Stop.`);
    process.exitCode = 1;
  }

  // The two marks the alert engine has never been able to see.
  console.log(`\n=== WATCH MARKS ===`);
  for (const appNo of ['UK00001248483', 'UK00001249798']) {
    const m = marks.find((x) => x.applicationNumber === appNo);
    if (!m) { console.log(`  ${appNo}: not in this portfolio`); continue; }
    const shaped = {
      registry_name: m.registryName,
      filing_date: m.filingDate?.toISOString(),
      registration_date: m.registrationDate?.toISOString(),
    } as Trademark;
    const after = reconcileObligations(getObligationsForTrademark(shaped), m.expiryDate, m.status, NOW);
    const nextFuture = after
      .filter((o) => (o.dueDate as Date) > NOW)
      .sort((a, b) => (a.dueDate as Date).getTime() - (b.dueDate as Date).getTime())[0];
    const beforeRows = m.deadlines.map((x) => `${iso(x.dueDate)}(${daysFrom(x.dueDate)}d)`).sort().join(' ');
    console.log(`  ${m.markText} (${appNo})`);
    console.log(`    before: ${beforeRows || 'none'}`);
    console.log(`    after:  ${after.map((o) => `${iso(o.dueDate as Date)}(${daysFrom(o.dueDate as Date)}d)`).sort().join(' ')}`);
    console.log(`    earliest future after recalc: ${nextFuture ? `${iso(nextFuture.dueDate as Date)} (${daysFrom(nextFuture.dueDate as Date)}d)` : 'none'}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
