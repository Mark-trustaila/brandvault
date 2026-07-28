/**
 * Delete an orphan company row by id — a husk minted by resolveCompany when
 * someone signed in against an org that had no Company yet.
 *
 *   npx tsx scripts/delete-orphan-company.ts \
 *     --company-id cms4iji350000ib04akzpuwew \
 *     --protect-company-id cmr6ir8cn0000p5m8r05a6i2d \
 *     --protect-org-id org_3H5cdXmkdRwLlUyntugVSLmNhBd \
 *     [--execute]
 *
 * Dry run by default.
 *
 * ## Why the checks are wider than "no marks, no users"
 *
 * companies cascades on delete to TEN relations: users, families, trademarks,
 * auditLogs, alertPreference, inboundEmails, notifications, breeQueryLogs,
 * approvals and watchNotices. A row with no marks and no users can still hold
 * audit entries or notifications, and deleting it would take them silently.
 * So every relation is counted and ANY non-zero count refuses the delete.
 *
 * The two --protect-* arguments are required rather than hardcoded: deleting a
 * tenant is the most destructive operation in this codebase, and naming what
 * must survive should be a deliberate act by the operator, not a constant a
 * future edit could quietly change.
 */
import { prisma } from '../lib/db';

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const str = (a: Args, k: string): string | null => (typeof a[k] === 'string' ? (a[k] as string).trim() : null);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const execute = args.execute === true;
  const companyId = str(args, 'company-id');
  const protectCompanyId = str(args, 'protect-company-id');
  const protectOrgId = str(args, 'protect-org-id');

  if (!companyId || !protectCompanyId || !protectOrgId) {
    throw new Error(
      'usage: --company-id <cuid> --protect-company-id <cuid> --protect-org-id <org_…> [--execute]'
    );
  }
  if (!protectOrgId.startsWith('org_')) throw new Error(`--protect-org-id must start with "org_" (got "${protectOrgId}")`);
  // Checked here, before any database access: a --company-id fat-fingered to
  // the protected id is the single worst input this script can receive, and it
  // should be refused instantly rather than after a connection round trip.
  if (companyId === protectCompanyId) {
    throw new Error(`refusing: --company-id equals --protect-company-id (${protectCompanyId})`);
  }

  console.log(`\n=== Delete orphan company (${execute ? 'EXECUTE' : 'DRY RUN'}) ===\n`);

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    console.log(`No company with id "${companyId}". Nothing to do (safe to re-run).\n`);
    return;
  }

  // Every relation that would cascade.
  const [users, families, trademarks, auditLogs, alertPreference, inboundEmails, notifications, breeQueryLogs, approvals, watchNotices] =
    await Promise.all([
      prisma.user.count({ where: { companyId } }),
      prisma.trademarkFamily.count({ where: { companyId } }),
      prisma.trademark.count({ where: { companyId } }),
      prisma.auditLog.count({ where: { companyId } }),
      prisma.alertPreference.count({ where: { companyId } }),
      prisma.inboundEmail.count({ where: { companyId } }),
      prisma.notification.count({ where: { companyId } }),
      prisma.breeQueryLog.count({ where: { companyId } }),
      prisma.approval.count({ where: { companyId } }),
      prisma.watchNotice.count({ where: { companyId } }),
    ]);

  const counts: Record<string, number> = {
    users, families, trademarks, auditLogs, alertPreference,
    inboundEmails, notifications, breeQueryLogs, approvals, watchNotices,
  };

  console.log('Target');
  console.log(`  id            ${company.id}`);
  console.log(`  name          ${company.name}`);
  console.log(`  slug          ${company.slug}`);
  console.log(`  clerk_org_id  ${company.clerkOrgId ?? '(null)'}`);
  console.log(`  created_at    ${company.createdAt.toISOString()}`);
  console.log('\nDependent rows (all must be 0)');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(16)} ${v}${v ? '   <-- BLOCKS DELETE' : ''}`);
  }

  const problems: string[] = [];
  if (company.id === protectCompanyId) problems.push(`target is the protected company (${protectCompanyId})`);
  if (company.clerkOrgId === protectOrgId) problems.push(`target carries the protected org id (${protectOrgId})`);
  const nonEmpty = Object.entries(counts).filter(([, v]) => v > 0);
  if (nonEmpty.length) problems.push(`not empty: ${nonEmpty.map(([k, v]) => `${k}=${v}`).join(', ')}`);

  if (problems.length) {
    console.log('\nREFUSING to delete:');
    problems.forEach((p) => console.log(`  - ${p}`));
    throw new Error('refusal checks failed');
  }

  console.log('\nAll checks passed. This row is an empty husk.');
  console.log('\nRestore values, in case it needs recreating:');
  console.log(`  name="${company.name}" slug="${company.slug}" clerk_org_id=${company.clerkOrgId ?? 'NULL'}`);

  if (!execute) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute to delete.\n');
    return;
  }

  await prisma.company.delete({ where: { id: company.id } });

  // Verify by reading back, and confirm the protected company is untouched.
  const gone = !(await prisma.company.findUnique({ where: { id: company.id } }));
  const protectedStillThere = await prisma.company.findUnique({ where: { id: protectCompanyId } });
  const protectedMarks = protectedStillThere
    ? await prisma.trademark.count({ where: { companyId: protectCompanyId } })
    : 0;

  console.log('\nAfter');
  console.log(`  orphan deleted           ${gone ? 'yes' : 'NO'}`);
  console.log(`  protected company intact ${protectedStillThere ? 'yes' : 'NO'} (${protectedMarks} marks)`);
  const ok = gone && Boolean(protectedStillThere) && protectedMarks > 0;
  console.log(ok ? '\nOK — orphan removed, portfolio intact.\n' : '\nMISMATCH — investigate immediately.\n');
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
