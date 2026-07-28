/**
 * Reattach a user to the right company, and delete the empty company their
 * login minted (if it minted one).
 *
 *   npx tsx scripts/fix-stray-tenant.ts \
 *     --clerk-user-id user_XXXX \
 *     --company-id cmr6ir8cn0000p5m8r05a6i2d \
 *     [--role viewer] [--delete-stray] [--execute]
 *
 * Dry run by default.
 *
 * ## When this is the wrong tool
 *
 * An empty dashboard does NOT imply a stray row. getActingCompany returns null
 * before touching the database when the session has no active organization, so
 * the API answers {count: 0, company: null} with nothing created. If the user
 * row does not exist, the problem is the Clerk session's active org and there
 * is nothing here to fix. This script reports that and exits rather than
 * inventing rows to paper over a session issue.
 *
 * ## Role durability warning
 *
 * lib/tenant.ts mapRole() returns only 'admin' or 'editor'. resolveUser()
 * reconciles role on every authenticated request, so a role written here that
 * mapRole cannot produce is overwritten on the user's next request. Setting
 * 'viewer' is therefore cosmetic until mapRole understands viewers. The script
 * refuses --role viewer unless --i-know-role-is-not-durable is passed, so this
 * cannot be discovered later in production.
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

// Companies that must never be deleted by this script, whatever else is true.
const PROTECTED_REASON = 'has trademarks, users other than the one being moved, or is the target company';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const execute = args.execute === true;
  const deleteStray = args['delete-stray'] === true;
  const clerkUserId = str(args, 'clerk-user-id');
  const companyId = str(args, 'company-id');
  const role = (str(args, 'role') ?? 'editor') as 'admin' | 'editor' | 'viewer';

  if (!clerkUserId || !companyId) {
    throw new Error('usage: --clerk-user-id user_… --company-id <cuid> [--role viewer] [--delete-stray] [--execute]');
  }
  if (!clerkUserId.startsWith('user_')) throw new Error(`--clerk-user-id must start with "user_" (got "${clerkUserId}")`);
  if (!['admin', 'editor', 'viewer'].includes(role)) throw new Error(`--role must be admin|editor|viewer`);
  if (role === 'viewer' && args['i-know-role-is-not-durable'] !== true) {
    throw new Error(
      'refusing --role viewer: lib/tenant.ts mapRole() only produces admin|editor, and resolveUser() ' +
      'reconciles role on every request, so viewer is overwritten on this user\'s next request. ' +
      'Fix mapRole, or pass --i-know-role-is-not-durable to proceed anyway.'
    );
  }

  console.log(`\n=== Stray tenant fix (${execute ? 'EXECUTE' : 'DRY RUN'}) ===\n`);

  const target = await prisma.company.findUnique({ where: { id: companyId } });
  if (!target) throw new Error(`No company with id "${companyId}"`);

  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    include: { company: true, platformAdmin: true },
  });

  const companies = await prisma.company.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { trademarks: true, users: true } } },
  });

  console.log('Companies');
  for (const c of companies) {
    const flag = c.id === target.id ? '  <- target' : '';
    console.log(`  ${c.id}  ${c.name}  slug=${c.slug}  org=${c.clerkOrgId ?? '(null)'}  marks=${c._count.trademarks}  users=${c._count.users}${flag}`);
  }

  if (!user) {
    console.log(`\nNo user row for ${clerkUserId}.`);
    console.log('Their login never reached resolveUser, which means the session had no active');
    console.log('organization. Nothing was created and there is nothing to repair here: set their');
    console.log('active org in Clerk instead. Exiting without changes.\n');
    return;
  }

  console.log('\nUser');
  console.log(`  id             ${user.id}`);
  console.log(`  email          ${user.email}`);
  console.log(`  role           ${user.role}  ->  ${role}`);
  console.log(`  company        ${user.company.name} (${user.companyId})  ->  ${target.name} (${target.id})`);
  console.log(`  platform admin ${user.platformAdmin ? 'YES' : 'no'}`);

  // A company is only a deletion candidate if this user's login plausibly made
  // it: no marks, and no users other than this one.
  const from = companies.find((c) => c.id === user.companyId);
  const strayEligible =
    from &&
    from.id !== target.id &&
    from._count.trademarks === 0 &&
    from._count.users <= 1;

  if (from && from.id !== target.id) {
    console.log('\nOrigin company');
    console.log(`  ${from.id}  ${from.name}  marks=${from._count.trademarks}  users=${from._count.users}`);
    console.log(`  deletable: ${strayEligible ? 'yes (empty)' : `NO — ${PROTECTED_REASON}`}`);
  }

  if (deleteStray && !strayEligible) {
    throw new Error('--delete-stray passed but the origin company is not safely deletable. Refusing.');
  }

  console.log('\nRollback values, keep these until the reviewer confirms:');
  console.log(`  users.company_id  ${user.companyId}   (user id ${user.id})`);
  console.log(`  users.role        ${user.role}`);
  if (deleteStray && from) {
    console.log(`  company to delete ${from.id} name="${from.name}" slug="${from.slug}" org=${from.clerkOrgId ?? 'NULL'}`);
  }

  if (!execute) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute to apply.\n');
    return;
  }

  // Reattach first, then delete: the company has ON DELETE CASCADE to users, so
  // deleting while the user still points at it would take the user with it.
  const ops = [prisma.user.update({ where: { id: user.id }, data: { companyId: target.id, role } })];
  if (deleteStray && from && strayEligible) {
    ops.push(prisma.company.delete({ where: { id: from.id } }) as never);
  }
  await prisma.$transaction(ops);

  const after = await prisma.user.findUnique({ where: { id: user.id }, include: { company: true } });
  const strayGone = deleteStray && from ? !(await prisma.company.findUnique({ where: { id: from.id } })) : true;
  const ok = after?.companyId === target.id && after?.role === role && strayGone;

  console.log('\nAfter');
  console.log(`  user company  ${after?.company.name} (${after?.companyId})`);
  console.log(`  user role     ${after?.role}`);
  if (deleteStray) console.log(`  stray removed ${strayGone ? 'yes' : 'NO'}`);
  console.log(ok ? '\nOK — reattached and verified.\n' : '\nMISMATCH — read back does not match intent.\n');
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('FAILED:', e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
