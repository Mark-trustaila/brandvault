/**
 * Recalculate + persist reconciled deadlines for ONE company's marks.
 *
 *   npx tsx scripts/backfill-deadlines.ts <company-slug>              # dry run
 *   npx tsx scripts/backfill-deadlines.ts <company-slug> --execute    # writes
 *
 * Run scripts/reconcile-report.ts first and review it. This script is the
 * execute path for what that report predicts; the counts it prints must match
 * the report you reviewed, and --expect-* below turns that into a gate rather
 * than an eyeball.
 *
 *   --execute              actually write. Absent, nothing is written.
 *   --expect-aligned=N     refuse to run if the classification disagrees with
 *   --expect-divergent=N   the report you reviewed. Any mismatch means the data
 *   --expect-no-expiry=N   moved underneath you; the run aborts before writing.
 *
 * WHAT IT SKIPS, and why each is a no-op rather than a rewrite:
 *
 *  - No registry expiry. Reconciliation needs a registry date to reconcile
 *    against; with none there is nothing to add and no disagreement to settle.
 *    The mark keeps the obligations it already has, untouched. Deleting and
 *    regenerating them would churn rows to reach the same answer, and would
 *    cost the alert state below for no gain.
 *  - Not live. `getObligationsForTrademark` derives renewals from the FILING
 *    date and gates on nothing, so a dead mark with a filing date is handed a
 *    fresh set of live renewal deadlines. The loader suppresses this on import
 *    (NO_DEADLINE_STATUSES in lib/gb-transform.ts) but the engine itself does
 *    not, so a maintenance pass over existing rows has to gate for itself.
 *  - Aligned with no movement in its future series. The sources already agree;
 *    rewriting is churn with a cost and no effect.
 *
 * ALERT STATE IS PRESERVED. `recalcDeadlines` replaces a mark's rows wholesale
 * (deleteMany + createMany), and the new rows carry neither `alert_*_sent` nor
 * `completedAt` — both are column defaults. Left alone that would reset the
 * sweep's dedupe memory, so the next cron re-alerts every deadline already
 * inside a threshold, and would resurrect renewals a human has confirmed
 * satisfied. This script captures both before the rewrite and restores them
 * onto the matching (type, dueDate) rows afterwards.
 *
 * Not safe to run against a company while the daily sweep is running: there is
 * a short window mid-rewrite where a deadline's flags read false.
 */
import { prisma } from '../lib/db';
import { recalcDeadlines, reconcileObligations } from '../lib/deadlines';
import { getObligationsForTrademark } from '../lib/utils';
import { isLiveStatus, sameDay } from '../lib/reconciliation';
import type { Trademark } from '../types/trademark';

const NOW = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const key = (type: string, due: Date) => `${type}@${iso(due)}`;

type Skip = 'no-registry-expiry' | 'not-live' | 'aligned-no-movement';

function parseExpect(argv: string[], name: string): number | null {
  const hit = argv.find((a) => a.startsWith(`--expect-${name}=`));
  if (!hit) return null;
  const n = Number(hit.split('=')[1]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--expect-${name} must be a whole number`);
  return n;
}

async function main() {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--'));
  const execute = argv.includes('--execute');

  // Required, and deliberately positional-with-no-default: the previous version
  // took no company at all and recalculated every mark in the database, across
  // every tenant, while the report that justifies the run is per-company.
  if (!slug) {
    console.error('usage: backfill-deadlines.ts <company-slug> [--execute] [--expect-aligned=N] [--expect-divergent=N] [--expect-no-expiry=N]');
    console.error('refusing to run without a company slug.');
    process.exitCode = 1;
    return;
  }

  const company = await prisma.company.findFirst({ where: { slug }, select: { id: true, name: true } });
  if (!company) {
    console.error(`no company with slug '${slug}'`);
    process.exitCode = 1;
    return;
  }

  const marks = await prisma.trademark.findMany({
    where: { companyId: company.id },
    include: { deadlines: true },
    orderBy: { markText: 'asc' },
  });

  // Classify exactly as scripts/reconcile-report.ts does, so the counts printed
  // here are comparable with the report that authorised the run.
  let aligned = 0;
  let divergent = 0;
  let noExpiry = 0;
  const planned: { mark: (typeof marks)[number]; concrete: ReturnType<typeof reconcileObligations> }[] = [];
  const skipped: { markText: string; appNo: string; why: Skip }[] = [];

  for (const m of marks) {
    const shaped = {
      registry_name: m.registryName,
      filing_date: m.filingDate?.toISOString(),
      registration_date: m.registrationDate?.toISOString(),
    } as Trademark;

    const obligations = getObligationsForTrademark(shaped);
    const before = obligations.filter((o) => !o.uncertain && o.dueDate);
    const after = reconcileObligations(obligations, m.expiryDate, m.status, NOW);
    const appNo = m.applicationNumber ?? '';

    if (!m.expiryDate) {
      noExpiry++;
      skipped.push({ markText: m.markText, appNo, why: 'no-registry-expiry' });
      continue;
    }

    const nextCalcFuture =
      before
        .filter((o) => o.type === 'Renewal' && (o.dueDate as Date) > NOW)
        .map((o) => o.dueDate as Date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const agrees = nextCalcFuture !== null && sameDay(nextCalcFuture, m.expiryDate);
    const anyCalcOnExpiry = before.some(
      (o) => o.type === 'Renewal' && sameDay(o.dueDate as Date, m.expiryDate as Date)
    );
    const isAligned = agrees || anyCalcOnExpiry;
    if (isAligned) aligned++;
    else divergent++;

    // Status gate applies whatever the classification: a non-live mark must not
    // be handed regenerated live obligations.
    if (!isLiveStatus(m.status)) {
      skipped.push({ markText: m.markText, appNo, why: 'not-live' });
      continue;
    }

    if (isAligned) {
      const futuresNow = m.deadlines
        .filter((d) => d.dueDate > NOW)
        .map((d) => key(d.type, d.dueDate))
        .sort()
        .join('|');
      const futuresAfter = after
        .filter((o) => (o.dueDate as Date) > NOW)
        .map((o) => key(o.type, o.dueDate as Date))
        .sort()
        .join('|');
      if (futuresNow === futuresAfter) {
        skipped.push({ markText: m.markText, appNo, why: 'aligned-no-movement' });
        continue;
      }
    }

    planned.push({ mark: m, concrete: after });
  }

  console.log(`company: ${company.name} (${slug}) — ${marks.length} marks\n`);
  console.log(`ALIGNED (sources agree):        ${aligned}`);
  console.log(`DIVERGENT (sources differ):     ${divergent}`);
  console.log(`NO REGISTRY EXPIRY:             ${noExpiry}`);

  const expectations: [string, number | null, number][] = [
    ['aligned', parseExpect(argv, 'aligned'), aligned],
    ['divergent', parseExpect(argv, 'divergent'), divergent],
    ['no-expiry', parseExpect(argv, 'no-expiry'), noExpiry],
  ];
  const mismatched = expectations.filter(([, want, got]) => want !== null && want !== got);
  if (mismatched.length) {
    console.error('\nCOUNTS DO NOT MATCH THE REVIEWED REPORT — refusing to write:');
    mismatched.forEach(([n, want, got]) => console.error(`  ${n}: expected ${want}, found ${got}`));
    console.error('The portfolio moved since the report. Re-run reconcile-report.ts and review again.');
    process.exitCode = 1;
    return;
  }

  const bucket = (why: Skip) => skipped.filter((s) => s.why === why);
  console.log(`\n=== SKIPPED: no registry expiry, left exactly as they are (${bucket('no-registry-expiry').length}) ===`);
  bucket('no-registry-expiry').forEach((s) => console.log(`  ${s.markText.slice(0, 26).padEnd(26)} ${s.appNo}`));
  console.log(`\n=== SKIPPED: not live, obligations not regenerated (${bucket('not-live').length}) ===`);
  bucket('not-live').forEach((s) => console.log(`  ${s.markText.slice(0, 26).padEnd(26)} ${s.appNo}`));
  console.log(`\n=== SKIPPED: aligned, future series already correct (${bucket('aligned-no-movement').length}) ===`);
  console.log(`  ${bucket('aligned-no-movement').length} marks`);

  console.log(`\n=== WOULD REWRITE (${planned.length}) ===`);
  for (const p of planned) {
    const now = p.mark.deadlines.map((d) => key(d.type, d.dueDate)).sort().join(' ');
    const next = p.concrete.map((o) => key(o.type, o.dueDate as Date)).sort().join(' ');
    console.log(`  ${p.mark.markText.slice(0, 26).padEnd(26)} ${(p.mark.applicationNumber ?? '').padEnd(15)}`);
    console.log(`    now:  ${now || 'none'}`);
    console.log(`    next: ${next || 'none'}`);
  }

  if (!execute) {
    console.log(`\nDRY RUN — nothing written. Re-run with --execute to apply.`);
    return;
  }

  let rewritten = 0;
  let flagsRestored = 0;
  let completionsRestored = 0;

  for (const p of planned) {
    // Capture the state recalcDeadlines is about to discard.
    const carried = new Map(
      p.mark.deadlines.map((d) => [
        key(d.type, d.dueDate),
        {
          alert180Sent: d.alert180Sent,
          alert90Sent: d.alert90Sent,
          alert30Sent: d.alert30Sent,
          completedAt: d.completedAt,
        },
      ])
    );

    await recalcDeadlines(p.mark);
    rewritten++;

    const fresh = await prisma.deadline.findMany({ where: { trademarkId: p.mark.id } });
    for (const row of fresh) {
      const prior = carried.get(key(row.type, row.dueDate));
      if (!prior) continue; // a genuinely new row (e.g. the registry date) starts clean
      const hadFlags = prior.alert180Sent || prior.alert90Sent || prior.alert30Sent;
      if (!hadFlags && !prior.completedAt) continue;
      await prisma.deadline.update({
        where: { id: row.id },
        data: {
          alert180Sent: prior.alert180Sent,
          alert90Sent: prior.alert90Sent,
          alert30Sent: prior.alert30Sent,
          completedAt: prior.completedAt,
        },
      });
      if (hadFlags) flagsRestored++;
      if (prior.completedAt) completionsRestored++;
    }
  }

  console.log(`\nWROTE ${rewritten} marks.`);
  console.log(`  alert dedupe restored on ${flagsRestored} rows`);
  console.log(`  completedAt restored on  ${completionsRestored} rows`);
  console.log(`deadlines table now holds ${await prisma.deadline.count()} rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
