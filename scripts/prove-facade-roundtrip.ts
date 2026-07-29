/**
 * Prove the registry-facade client against LIVE staging.
 * ======================================================
 * One real round trip — search-by-owner('ASOS') → getMarks(chosen owners) —
 * then feed the facade's /marks doc through the SAME transform the loader uses
 * (gb-transform#readExportDoc), and cross-check parity against the frozen export
 * file the loader was validated against. Read-only; no DB writes.
 *
 * Run BEFORE building UI on the client (per the handoff gate).
 *
 *   REGISTRY_FACADE_URL=… REGISTRY_FACADE_KEY=… REGISTRY_FACADE_FN_KEY=… \
 *     npx tsx scripts/prove-facade-roundtrip.ts
 *
 *   [EXPORT_FILE=~/lawpanel/scratch/exports/asos-gb-20260724.json]  # parity source
 *
 * Exit 0 = all assertions pass, 1 = any failure.
 */
import { searchByOwner, getMarks, getMark, health, CapExceededError } from '../lib/registry-facade';
import { readExport, readExportDoc, applicantNames, type ExportMark } from './gb-transform';

let pass = 0, fail = 0;
const line: string[] = [];
const ok = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; line.push(`  ✅ ${name}`); }
  else { fail++; line.push(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

const EXPORT_FILE = process.env.EXPORT_FILE || '~/lawpanel/scratch/exports/asos-gb-20260724.json';
const ASOS_OWNERS = ['ASOS plc', 'ASOS HOLDINGS LIMITED']; // the in-scope proprietors

async function main() {
  console.log('\nProve registry-facade client → live staging\n');

  // 0. health — reachability + the currency/coverage the UI must surface
  const h = await health();
  ok('health: baseX reachable', h.baseXReachable === true);
  ok('health: currencyDate present', /^\d{4}-\d{2}-\d{2}$/.test(h.currencyDate), h.currencyDate);
  console.log(`  · corpus as at ${h.currencyDate}; UK009 partial=${h.coverage?.uk009?.partial} (~${h.coverage?.uk009?.approxPct}%)\n`);

  // 1. search-by-owner('ASOS') — the checkbox step
  const sbo = await searchByOwner('ASOS');
  const by = Object.fromEntries(sbo.owners.map((o) => [o.ownerString, o]));
  ok('search-by-owner: totalDistinctMarks = 204', sbo.totalDistinctMarks === 204, `${sbo.totalDistinctMarks}`);
  ok('search-by-owner: ASOS plc = 102 (owner)', by['ASOS plc']?.markCount === 102 && by['ASOS plc']?.matchedVia.includes('owner'));
  ok('search-by-owner: ASOS HOLDINGS LIMITED = 71 (owner)', by['ASOS HOLDINGS LIMITED']?.markCount === 71);
  ok('search-by-owner: Shenzhen asos... = 6 (owner, unrelated party surfaced)', by['Shenzhen asos E-Commerce Ltd.']?.markCount === 6);
  ok('search-by-owner: ASOS PLC = 133 (representative-only)', by['ASOS PLC']?.matchedVia.includes('representative') && !by['ASOS PLC']?.matchedVia.includes('owner'));

  // The checkbox default per contract §3b.1: owner-matched checked, rep-only unchecked.
  const ownerChecked = sbo.owners.filter((o) => o.matchedVia.includes('owner')).map((o) => o.ownerString);
  console.log(`  · owner-matched (default-checked): ${ownerChecked.join(', ')}`);
  console.log(`  · representative-only (default-unchecked): ${sbo.owners.filter((o) => !o.matchedVia.includes('owner')).map((o) => o.ownerString).join(', ') || '(none)'}\n`);

  // 2. getMarks(chosen ASOS owners) — the preview/import payload
  const doc = await getMarks(ASOS_OWNERS);
  ok('marks: unmatched owner strings none', (doc.unmatchedOwnerStrings ?? []).length === 0, JSON.stringify(doc.unmatchedOwnerStrings));
  ok('marks: currencyDate matches health', doc.currencyDate === h.currencyDate);

  // 3. feed the facade doc through the loader's own transform
  const r = readExportDoc(doc as { export: any; marks: ExportMark[] });
  ok('transform: in-scope mapped = 173', r.mapped.length === 173, `${r.mapped.length}`);
  ok('transform: zero unmapped statuses (loader would not abort)', r.unmappedStatuses.length === 0, r.unmappedStatuses.join(','));
  ok('transform: no node_id leaked into marks', (doc.marks as ExportMark[]).every((m) => m.node_id === undefined));
  const series = r.mapped.reduce<Record<string, number>>((a, m) => ((a[m.seriesPrefix] = (a[m.seriesPrefix] ?? 0) + 1), a), {});
  ok('transform: series UK000/UK008/UK009 = 138/4/31', series.UK000 === 138 && series.UK008 === 4 && series.UK009 === 31, JSON.stringify(series));
  const gs = r.mapped.reduce((n, m) => n + m.goodsServices.length, 0);
  const dl = r.mapped.reduce((n, m) => n + m.deadlines.length, 0);
  ok('transform: goods/services rows > 0', gs > 0, `${gs}`);
  console.log(`  · rows the loader would write: ${r.mapped.length} trademarks, ${gs} goods/services, ${dl} deadlines\n`);

  // 4. parity vs the frozen export file (what the loader was validated on)
  let expDoc: ReturnType<typeof readExport> | null = null;
  try { expDoc = readExport(EXPORT_FILE); } catch { /* optional */ }
  if (expDoc) {
    const fileApps = new Set(expDoc.mapped.map((m) => m.applicationNumber));
    const liveApps = new Set(r.mapped.map((m) => m.applicationNumber));
    const missing = Array.from(fileApps).filter((a) => !liveApps.has(a));
    const extra = Array.from(liveApps).filter((a) => !fileApps.has(a));
    ok('parity: same application-number set as export file', missing.length === 0 && extra.length === 0, `missing ${missing.length}, extra ${extra.length}`);
    const fileStatus = Object.fromEntries(expDoc.mapped.map((m) => [m.applicationNumber, m.registryStatusRaw]));
    ok('parity: verbatim statuses match export file', r.mapped.every((m) => fileStatus[m.applicationNumber] === m.registryStatusRaw));
  } else {
    line.push(`  ⚠️  parity: export file not found at ${EXPORT_FILE} (skipped)`);
  }

  // 5. single-mark fetch + graceful cap handling
  const one = await getMark('UK00003648574');
  ok('mark: UK00003648574 = ASOS ACTUAL / Registered', one?.mark_text?.[0] === 'ASOS ACTUAL' && one?.status === 'Registered');
  ok('mark: unknown returns null (404 handled)', (await getMark('UK00009999999')) === null);
  try {
    await getMarks(["L'Oréal"]); // 2,320 > 2,000 cap
    ok('cap: L\'Oréal refused with count', false, 'expected CapExceededError');
  } catch (e) {
    ok('cap: L\'Oréal → CapExceededError with count', e instanceof CapExceededError && (e as CapExceededError).matchedDistinctMarks > 2000);
  }

  console.log(line.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed.\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('proof run error:', e); process.exit(2); });
