/**
 * Preflight for migrations-pending/20260729120000_portfolio_import.
 * =================================================================
 * Read-only. Asserts no existing rows would violate the new unique index
 * trademarks(company_id, registry_name, application_number) before it is
 * applied. NULL application_number is excluded (MySQL allows multiple NULLs).
 *
 *   DATABASE_URL="<azure>" npx tsx scripts/preflight-unique-index.ts
 *
 * Exit 0 = safe to apply, 1 = violations (do not apply).
 */
import { prisma } from '../lib/db';

(async () => {
  const dupes = await prisma.$queryRawUnsafe<Array<{ company_id: string; registry_name: string; application_number: string; c: bigint }>>(
    `SELECT company_id, registry_name, application_number, COUNT(*) c
       FROM trademarks
      WHERE application_number IS NOT NULL
      GROUP BY company_id, registry_name, application_number
     HAVING COUNT(*) > 1`,
  );
  const [{ c: total }] = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT COUNT(*) c FROM trademarks`);
  const [{ c: nullApp }] = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT COUNT(*) c FROM trademarks WHERE application_number IS NULL`);

  console.log(`trademarks total:                          ${total}`);
  console.log(`null application_number (not constrained): ${nullApp}`);
  console.log(`duplicate (company,registry,appno) groups: ${dupes.length}`);

  if (dupes.length) {
    console.log('\n✗ VIOLATIONS — unique index cannot be applied:');
    for (const d of dupes.slice(0, 20)) console.log(`   ${d.company_id} | ${d.registry_name} | ${d.application_number} ×${d.c}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('\n✓ no violations — safe to apply trademarks_company_registry_appno_key');
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
