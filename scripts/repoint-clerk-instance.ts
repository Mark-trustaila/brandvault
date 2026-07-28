/**
 * Repoint a Company and a User from the development Clerk instance to the
 * production one.
 *
 *   npx tsx scripts/repoint-clerk-instance.ts \
 *     --company-slug asos-plc \
 *     --org-id org_XXXX \
 *     --email mkw@mkwassoc.co.uk \
 *     --user-id user_XXXX
 *
 * Dry run by default. Pass --execute to write.
 *
 * ## Why this exists rather than letting the lazy sync handle it
 *
 * lib/tenant.ts syncs Clerk to our tables on request. Faced with an unknown
 * org or user it INSERTS. Against a database that already holds the dev-era
 * rows that is not a migration, it is a collision:
 *
 *   - `users.email` is @unique and the production Clerk user has the same
 *     address as the dev one, so resolveUser's upsert-create raises P2002 and
 *     every authenticated request 500s.
 *   - `companies.slug` is @unique, so resolveCompany's upsert-create either
 *     raises P2002 too, or (if the production org's slug differs) quietly
 *     creates a second, empty company and strands the real portfolio.
 *   - `platform_admins.user_id` references `users.id`, so a newly inserted
 *     user row would not carry the platform-admin grant.
 *
 * So this repoints the EXISTING rows in place. Everything keyed on users.id
 * (notes, audit log, notification reads, Bree query logs) and on companies.id
 * (trademarks, deadlines, approvals, watch notices) is preserved untouched.
 *
 * ## Order of operations
 *
 * Run this BEFORE anyone signs in against the production instance. A single
 * login ahead of it can create the colliding rows this is meant to prevent.
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
  const companySlug = str(args, 'company-slug');
  const orgId = str(args, 'org-id');
  const email = str(args, 'email');
  const userId = str(args, 'user-id');

  if (!companySlug || !orgId || !email || !userId) {
    throw new Error('usage: --company-slug <slug> --org-id <org_…> --email <addr> --user-id <user_…> [--execute]');
  }
  // Clerk ids are prefixed; a pasted name or a placeholder left unfilled is the
  // likeliest input error and is worth refusing loudly.
  if (!orgId.startsWith('org_')) throw new Error(`--org-id must start with "org_" (got "${orgId}")`);
  if (!userId.startsWith('user_')) throw new Error(`--user-id must start with "user_" (got "${userId}")`);

  console.log(`\n=== Clerk instance repoint (${execute ? 'EXECUTE' : 'DRY RUN'}) ===\n`);

  // ---- Preflight: read every row this touches, and every row that could collide.
  const company = await prisma.company.findUnique({ where: { slug: companySlug } });
  if (!company) throw new Error(`No company with slug "${companySlug}"`);

  const user = await prisma.user.findFirst({
    where: { email },
    include: { platformAdmin: true, company: { select: { name: true, slug: true } } },
  });
  if (!user) throw new Error(`No user with email "${email}"`);

  const orgClash = await prisma.company.findUnique({ where: { clerkOrgId: orgId } });
  const userClash = await prisma.user.findUnique({ where: { clerkUserId: userId } });

  console.log('Company');
  console.log(`  id              ${company.id}`);
  console.log(`  name            ${company.name}`);
  console.log(`  slug            ${company.slug}`);
  console.log(`  clerk_org_id    ${company.clerkOrgId ?? '(null)'}  ->  ${orgId}`);
  console.log('\nUser');
  console.log(`  id              ${user.id}`);
  console.log(`  email           ${user.email}`);
  console.log(`  role            ${user.role}`);
  console.log(`  company         ${user.company.name} (${user.company.slug})`);
  console.log(`  platform admin  ${user.platformAdmin ? 'YES' : 'no'}`);
  console.log(`  clerk_user_id   ${user.clerkUserId}  ->  ${userId}`);

  // What rides along on these two ids, so the blast radius is on the record.
  const [marks, notes, audits, reads, queries] = await Promise.all([
    prisma.trademark.count({ where: { companyId: company.id } }),
    prisma.note.count({ where: { userId: user.id } }),
    prisma.auditLog.count({ where: { userId: user.id } }),
    prisma.notificationRead.count({ where: { userId: user.id } }),
    prisma.breeQueryLog.count({ where: { userId: user.id } }),
  ]);
  console.log('\nPreserved by repointing in place (would be orphaned by an insert)');
  console.log(`  trademarks on this company   ${marks}`);
  console.log(`  notes by this user           ${notes}`);
  console.log(`  audit entries by this user   ${audits}`);
  console.log(`  notification reads           ${reads}`);
  console.log(`  bree query logs              ${queries}`);

  // ---- Refuse anything ambiguous rather than guessing.
  const problems: string[] = [];
  if (orgClash && orgClash.id !== company.id) {
    problems.push(`org id ${orgId} is already on company "${orgClash.name}" (${orgClash.id})`);
  }
  if (userClash && userClash.id !== user.id) {
    problems.push(`user id ${userId} is already on user "${userClash.email}" (${userClash.id})`);
  }
  if (user.companyId !== company.id) {
    problems.push(`user's company (${user.companyId}) is not the company being repointed (${company.id})`);
  }
  if (problems.length) {
    console.log('\nREFUSING — resolve these first:');
    problems.forEach((p) => console.log(`  - ${p}`));
    throw new Error('preflight failed');
  }

  const alreadyDone = company.clerkOrgId === orgId && user.clerkUserId === userId;
  if (alreadyDone) {
    console.log('\nAlready repointed. Nothing to do (safe to re-run).');
    return;
  }

  console.log('\nRollback values, keep these until login is confirmed:');
  console.log(`  companies.clerk_org_id  ${company.clerkOrgId ?? 'NULL'}  (company id ${company.id})`);
  console.log(`  users.clerk_user_id     ${user.clerkUserId}             (user id ${user.id})`);

  if (!execute) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute to apply.\n');
    return;
  }

  // ---- Write. One transaction: a half-applied repoint is a locked-out login.
  await prisma.$transaction([
    prisma.company.update({ where: { id: company.id }, data: { clerkOrgId: orgId } }),
    prisma.user.update({ where: { id: user.id }, data: { clerkUserId: userId } }),
  ]);

  // ---- Verify by reading back, not by trusting the write.
  const afterCompany = await prisma.company.findUnique({ where: { id: company.id } });
  const afterUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { platformAdmin: true },
  });
  const ok =
    afterCompany?.clerkOrgId === orgId &&
    afterUser?.clerkUserId === userId &&
    Boolean(afterUser?.platformAdmin) === Boolean(user.platformAdmin);

  console.log('\nAfter');
  console.log(`  companies.clerk_org_id  ${afterCompany?.clerkOrgId}`);
  console.log(`  users.clerk_user_id     ${afterUser?.clerkUserId}`);
  console.log(`  platform admin          ${afterUser?.platformAdmin ? 'YES' : 'no'}`);
  console.log(ok ? '\nOK — repointed and verified.\n' : '\nMISMATCH — read back does not match intent. Investigate before signing in.\n');
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
