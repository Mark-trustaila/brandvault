/**
 * Dry-run report for a live-GB registry export.
 * ==============================================
 * Reports only — no database connection, no writes. Shares its transform with
 * the loader (scripts/gb-transform.ts) so this report describes exactly what
 * scripts/load-gb-execute.ts would write.
 *
 *   npx tsx scripts/load-gb-export.ts ~/lawpanel/scratch/exports/asos-gb-20260724.json
 *   npx tsx scripts/load-gb-export.ts <export.json> --excluded   # what's skipped
 *   npx tsx scripts/load-gb-export.ts <export.json> --json       # mapped output
 */
import { STATUS_MAP, applicantNames, readExport } from '../lib/gb-transform';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: npx tsx scripts/load-gb-export.ts <export.json> [--json] [--excluded]');
  process.exit(1);
}

const { header, all, excluded, mapped, unmappedStatuses } = readExport(file);

const tally = <T>(xs: T[], k: (x: T) => string) =>
  xs.reduce<Record<string, number>>((a, x) => ((a[k(x)] = (a[k(x)] ?? 0) + 1), a), {});

console.log(`\nExport:      ${file}`);
console.log(`Source:      ${header.source ?? '(none)'}`);
console.log(`Exported:    ${header.export_date ?? '(none)'}`);
if (header.index_scope_caveat) console.log(`Index scope: ${header.index_scope_caveat}`);

console.log(`\n── SCOPE ──`);
console.log(`  marks in export        ${all.length}`);
console.log(`  in scope (applicant)   ${mapped.length}`);
console.log(`  excluded               ${excluded.length}`);
for (const [k, v] of Object.entries(tally(excluded, (m) => applicantNames(m)[0] ?? '(none)')).sort())
  console.log(`      ${k.padEnd(32)} ${v}`);

console.log(`\n── STATUS MAPPING ──`);
for (const [raw, n] of Object.entries(tally(mapped, (m) => m.registryStatusRaw)).sort())
  console.log(`  ${(raw in STATUS_MAP ? '✓' : '✗')} ${raw.padEnd(24)} → ${String(STATUS_MAP[raw] ?? '(UNMAPPED)').padEnd(12)} ${n}`);

console.log(`\n── SERIES ──`);
for (const [k, v] of Object.entries(tally(mapped, (m) => m.seriesPrefix)).sort())
  console.log(`  ${k.padEnd(8)} ${v}`);

console.log(`\n── ROWS OUT ──`);
console.log(`  trademarks             ${mapped.length}`);
console.log(`  goods_and_services     ${mapped.reduce((n, m) => n + m.goodsServices.length, 0)}`);
console.log(`  deadlines              ${mapped.reduce((n, m) => n + m.deadlines.length, 0)}`);
console.log(`     suppressed on       ${mapped.filter((m) => m.deadlinesSuppressed).length} marks (dead statuses)`);

console.log(`\n── COMPLETENESS ──`);
console.log(`  needsData                    ${mapped.filter((m) => m.needsData).length}`);
console.log(`  synthesised mark text        ${mapped.filter((m) => m.markTextSynthesised).length}`);
console.log(`  missing registration date    ${mapped.filter((m) => !m.registrationDate).length}`);
console.log(`  with representative          ${mapped.filter((m) => m.representativeName).length}`);
console.log(`  bad class numbers            ${mapped.reduce((n, m) => n + m.goodsServices.filter((g) => !Number.isInteger(g.classNumber)).length, 0)}`);

console.log(`\n── OWNER SPLIT ──`);
for (const [k, v] of Object.entries(tally(mapped, (m) => m.ownerName ?? '(none)')).sort())
  console.log(`  ${k.padEnd(24)} ${v}`);

if (argv.includes('--excluded')) {
  console.log(`\n── EXCLUDED ──`);
  for (const m of excluded)
    console.log(`  ${m.application_number}  ${(applicantNames(m)[0] ?? '?').padEnd(30)} via ${m.matched_via.join('+')}`);
}
if (argv.includes('--json')) console.log(JSON.stringify(mapped, null, 2));

if (unmappedStatuses.length) {
  console.error(`\nUNMAPPED STATUS VALUES — load must not proceed: ${unmappedStatuses.join(', ')}`);
  process.exit(1);
}
console.error('\nReport only — nothing written.');
