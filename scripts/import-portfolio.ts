/**
 * Import a company's portfolio from the registry facade.
 * ======================================================
 * The parameterised, idempotent successor to load-gb-execute.ts. Sources marks
 * live from the facade, writes them through lib/import-portfolio with every
 * loader gate. Dry run by default; --write executes.
 *
 *   REGISTRY_FACADE_URL=… REGISTRY_FACADE_KEY=… REGISTRY_FACADE_FN_KEY=… \
 *     npx tsx scripts/import-portfolio.ts --company asos-plc \
 *       --owners "ASOS plc,ASOS HOLDINGS LIMITED"            # dry run
 *
 *   … --write            execute (snapshot written first, as rollback material)
 *   … --prune            delete marks absent from the result (default: keep+report)
 *
 * The snapshot (facade doc + pre-image of affected marks) is written to
 * import-snapshots/<slug>-<timestamp>.json BEFORE any write, so a failed or
 * regretted import is always recoverable.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { prepareImport, commitImport, ImportAbortError, ImportVerificationError } from '../lib/import-portfolio';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const PRUNE = argv.includes('--prune');
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const companySlug = opt('company');
const owners = (opt('owners') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

if (!companySlug || !owners.length) {
  console.error('usage: import-portfolio.ts --company <slug> --owners "A,B" [--write] [--prune]');
  process.exit(1);
}

const SNAP_DIR = 'import-snapshots';

(async () => {
  const prepared = await prepareImport({ companySlug, ownerStrings: owners, pruneAbsent: PRUNE });
  const { predicted, plan, currencyDate } = prepared;

  console.log(`\nCompany:   ${companySlug} (${prepared.companyId})`);
  console.log(`Registry:  ${prepared.registryName}  ·  corpus as at ${currencyDate}`);
  console.log(`Owners:    ${owners.join(', ')}`);
  console.log(`\nPLAN`);
  console.log(`  insert   ${plan.toInsert}`);
  console.log(`  update   ${plan.toUpdate}   (in place — ids + notes preserved)`);
  console.log(`  stale    ${plan.stale.length}   ${PRUNE ? '→ PRUNE (delete + children)' : '→ kept, reported'}`);
  console.log(`\nPREDICTED WRITE  ${predicted.marks} marks · ${predicted.goodsServices} goods/services · ${predicted.deadlines} deadlines`);

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written. Re-run with --write to execute.');
    return;
  }

  // Persist the snapshot BEFORE the write — rollback material must exist first.
  mkdirSync(SNAP_DIR, { recursive: true });
  const stamp = prepared.snapshot.importedAt.replace(/[:.]/g, '-');
  const snapPath = `${SNAP_DIR}/${companySlug}-${stamp}.json`;
  writeFileSync(snapPath, JSON.stringify(prepared.snapshot, null, 2));
  console.log(`\nsnapshot written: ${snapPath}  (${prepared.snapshot.preImage.length} pre-image marks)`);

  const result = await commitImport(prepared);
  console.log(`\nWRITTEN + VERIFIED`);
  console.log(`  marks           ${result.actual.marks} / ${predicted.marks}`);
  console.log(`  goods/services  ${result.actual.goodsServices} / ${predicted.goodsServices}`);
  console.log(`  deadlines       ${result.actual.deadlines} / ${predicted.deadlines}`);
  console.log(`\n✓ import committed. Snapshot ${snapPath} is the rollback material.`);
})().catch((e) => {
  if (e instanceof ImportAbortError) console.error(`\nABORT (no write): ${e.reason}`);
  else if (e instanceof ImportVerificationError) console.error(`\nROLLED BACK: ${e.message}`);
  else console.error('\nFAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
