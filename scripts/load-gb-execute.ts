/**
 * Executes the approved GB load — docs/gb-load-plan.md.
 * =====================================================
 * Replaces the fabricated UKIPO seed for a company with real registry data.
 *
 *   npx tsx scripts/load-gb-execute.ts <export.json>            # dry run
 *   npx tsx scripts/load-gb-execute.ts <export.json> --write    # execute
 *
 * Writes only with --write. Refuses to run unless preconditions hold:
 *   · registry_status_raw column exists (the pending migration is applied)
 *   · every source status value is mapped
 *   · the counts about to be written match the plan's predictions
 *
 * Deletes cascade to deadlines and goods/services (required FKs) and null the
 * mark pointer on bree_query_logs (nullable FK, SetNull). audit_logs has no
 * trademark FK and is untouched by design — see §7 of the plan.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db';
import { readExport } from '../lib/gb-transform';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const WRITE = argv.includes('--write');
const SLUG = 'asos-plc';
const REGISTRY = 'UKIPO';

/** Plan predictions. A mismatch stops the load rather than writing something unreviewed. */
const EXPECT = { marksIn: 173, goodsServices: 999, deadlines: 294, totalAfter: 222 };

if (!file) {
  console.error('usage: npx tsx scripts/load-gb-execute.ts <export.json> [--write]');
  process.exit(1);
}

const fail = (msg: string): never => {
  console.error(`\nABORT: ${msg}`);
  process.exit(1);
};

(async () => {
  const { mapped, unmappedStatuses } = readExport(file);

  /* ── preconditions ──────────────────────────────────────────── */
  if (unmappedStatuses.length) fail(`unmapped status values: ${unmappedStatuses.join(', ')}`);

  const col: any[] = await prisma.$queryRawUnsafe(
    "SHOW COLUMNS FROM trademarks LIKE 'registry_status_raw'",
  );
  if (!col.length) fail('registry_status_raw column missing — apply the pending migration first');

  const company = await prisma.company.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!company) fail(`company ${SLUG} not found`);

  const gs = mapped.reduce((n, m) => n + m.goodsServices.length, 0);
  const dl = mapped.reduce((n, m) => n + m.deadlines.length, 0);
  if (mapped.length !== EXPECT.marksIn) fail(`marks ${mapped.length} ≠ predicted ${EXPECT.marksIn}`);
  if (gs !== EXPECT.goodsServices) fail(`goods/services ${gs} ≠ predicted ${EXPECT.goodsServices}`);
  if (dl !== EXPECT.deadlines) fail(`deadlines ${dl} ≠ predicted ${EXPECT.deadlines}`);

  /* ── current state ──────────────────────────────────────────── */
  const doomed = await prisma.trademark.findMany({
    where: { companyId: company!.id, registryName: REGISTRY },
    select: { id: true },
  });
  const doomedIds = doomed.map((m) => m.id);
  const before = {
    marksTotal: await prisma.trademark.count({ where: { companyId: company!.id } }),
    marksUkipo: doomed.length,
    goodsServices: await prisma.goodsService.count({ where: { trademarkId: { in: doomedIds } } }),
    deadlines: await prisma.deadline.count({ where: { trademarkId: { in: doomedIds } } }),
    notes: await prisma.note.count({ where: { trademarkId: { in: doomedIds } } }),
    breeQueryLogs: await prisma.breeQueryLog.count({ where: { matchedTrademarkId: { in: doomedIds } } }),
    auditLogs: await prisma.auditLog.count({ where: { companyId: company!.id } }),
  };

  console.log(`\nCompany: ${company!.name} (${company!.id})`);
  console.log('BEFORE:', JSON.stringify(before, null, 1));
  console.log(`\nWILL WRITE: delete ${before.marksUkipo} marks → insert ${mapped.length} marks, ${gs} goods/services, ${dl} deadlines`);

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write to execute.');
    await prisma.$disconnect();
    return;
  }

  /* ── execute ────────────────────────────────────────────────── */
  // Ids are assigned here so trademarks and their children can go in as two
  // bulk inserts instead of 173 round trips to Azure.
  const rows = mapped.map((m) => ({ id: randomUUID(), m }));

  await prisma.$transaction(
    async (tx) => {
      await tx.trademark.deleteMany({ where: { companyId: company!.id, registryName: REGISTRY } });

      await tx.trademark.createMany({
        data: rows.map(({ id, m }) => ({
          id,
          companyId: company!.id,
          familyId: null, // families are explicit entities, never inferred
          registryName: m.registryName,
          markText: m.markText,
          status: m.status,
          registryStatusRaw: m.registryStatusRaw,
          applicationNumber: m.applicationNumber,
          registrationNumber: m.registrationNumber,
          filingDate: m.filingDate,
          registrationDate: m.registrationDate,
          expiryDate: m.expiryDate,
          publicationDate: m.publicationDate,
          ownerName: m.ownerName,
          ownerCountry: m.ownerCountry,
          representativeName: m.representativeName,
          representativeReference: m.representativeReference,
          clientAgentName: m.clientAgentName,
          needsData: m.needsData,
        })),
      });

      await tx.goodsService.createMany({
        data: rows.flatMap(({ id, m }) =>
          m.goodsServices.map((g) => ({ trademarkId: id, classNumber: g.classNumber, text: g.description })),
        ),
      });

      await tx.deadline.createMany({
        data: rows.flatMap(({ id, m }) =>
          m.deadlines.map((d) => ({
            trademarkId: id,
            type: d.type,
            description: d.description,
            dueDate: d.dueDate,
            windowStart: d.windowStart,
          })),
        ),
      });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  /* ── verify ─────────────────────────────────────────────────── */
  const newIds = rows.map((r) => r.id);
  const after = {
    marksTotal: await prisma.trademark.count({ where: { companyId: company!.id } }),
    marksUkipo: await prisma.trademark.count({ where: { companyId: company!.id, registryName: REGISTRY } }),
    goodsServices: await prisma.goodsService.count({ where: { trademarkId: { in: newIds } } }),
    deadlines: await prisma.deadline.count({ where: { trademarkId: { in: newIds } } }),
    auditLogs: await prisma.auditLog.count({ where: { companyId: company!.id } }),
    breeQueryLogs: await prisma.breeQueryLog.count({ where: { companyId: company!.id } }),
    breeQueryLogsWithNullMark: await prisma.breeQueryLog.count({
      where: { companyId: company!.id, matchedTrademarkId: null },
    }),
    orphanedGoodsServices: await prisma.goodsService.count({ where: { trademark: { companyId: company!.id, registryName: REGISTRY }, NOT: { trademarkId: { in: newIds } } } }),
  };
  console.log('\nAFTER:', JSON.stringify(after, null, 1));

  const checks: Array<[string, boolean, string]> = [
    ['marks total', after.marksTotal === EXPECT.totalAfter, `${after.marksTotal} vs ${EXPECT.totalAfter}`],
    ['marks UKIPO', after.marksUkipo === EXPECT.marksIn, `${after.marksUkipo} vs ${EXPECT.marksIn}`],
    ['goods/services', after.goodsServices === EXPECT.goodsServices, `${after.goodsServices} vs ${EXPECT.goodsServices}`],
    ['deadlines', after.deadlines === EXPECT.deadlines, `${after.deadlines} vs ${EXPECT.deadlines}`],
    ['audit rows preserved', after.auditLogs === before.auditLogs, `${after.auditLogs} vs ${before.auditLogs}`],
    ['bree logs preserved', after.breeQueryLogs >= before.breeQueryLogs, `${after.breeQueryLogs}`],
  ];
  console.log('');
  let ok = true;
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? '✓' : '✗'} ${name.padEnd(24)} ${detail}`);
    if (!pass) ok = false;
  }
  console.log(ok ? '\nAll post-load checks match the plan.' : '\nPOST-LOAD MISMATCH — investigate before proceeding.');

  await prisma.$disconnect();
  if (!ok) process.exit(1);
})().catch(async (e) => {
  console.error('\nFAILED:', e instanceof Error ? e.message : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
