/**
 * Device-mark image data patch (7a). Seven GB figurative marks.
 *
 *   dry run:  ( set -a; . ./.env.azure.local; set +a; npx tsx scripts/load-device-images.ts )
 *   execute:  ...same, with --execute
 *
 * URLs are stored EXACTLY as verified, never templated from the application
 * number. UK00002182599 carries a `_1_0` suffix that no template would produce,
 * which is the whole reason this is a fixed mapping and not a rule.
 *
 * Uses raw SQL for the write so it runs against the applied column without
 * depending on the Prisma model patch landing first.
 *
 * Idempotent: re-running sets the same values.
 */
import { prisma } from '../lib/db';

/** Verified 200 on all seven. Source: LawPanel CDN. */
export const DEVICE_IMAGES: Record<string, string> = {
  UK00002182599: 'https://lawpanel-data.azureedge.net/images/GB/UK00002182599_1_0.jpg',
  UK00003757828: 'https://lawpanel-data.azureedge.net/images/GB/UK00003757828.jpg',
  UK00003819949: 'https://lawpanel-data.azureedge.net/images/GB/UK00003819949.jpg',
  UK00003834437: 'https://lawpanel-data.azureedge.net/images/GB/UK00003834437.jpg',
  UK00003843033: 'https://lawpanel-data.azureedge.net/images/GB/UK00003843033.jpg',
  UK00906273701: 'https://lawpanel-data.azureedge.net/images/GB/UK00906273701.jpg',
  UK00909134181: 'https://lawpanel-data.azureedge.net/images/GB/UK00909134181.jpg',
};

async function main() {
  const execute = process.argv.includes('--execute');
  const appNos = Object.keys(DEVICE_IMAGES);

  // Column check first: this patch is meaningless before the migration lands.
  const cols = await prisma.$queryRaw<Array<{ c: bigint | number }>>`
    SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'trademarks' AND column_name = 'image_url'`;
  if (Number(cols[0]?.c ?? 0) === 0) {
    console.error('trademarks.image_url does not exist. Apply 20260725140000_trademark_image_url first.');
    process.exitCode = 1;
    return;
  }

  const marks = await prisma.trademark.findMany({
    where: { applicationNumber: { in: appNos } },
    select: { id: true, applicationNumber: true, markText: true, registryName: true },
  });

  console.log(`mapping entries: ${appNos.length}, matched in portfolio: ${marks.length}`);
  const missing = appNos.filter((a) => !marks.some((m) => m.applicationNumber === a));
  if (missing.length) console.log(`NOT FOUND (skipped): ${missing.join(', ')}`);
  for (const m of marks) {
    console.log(`  ${m.applicationNumber}  ${m.registryName}  ${m.markText}`);
    console.log(`    -> ${DEVICE_IMAGES[m.applicationNumber!]}`);
  }

  if (!execute) {
    console.log('\nDRY RUN. Nothing written.');
    return;
  }

  let written = 0;
  for (const m of marks) {
    const url = DEVICE_IMAGES[m.applicationNumber!];
    written += await prisma.$executeRaw`UPDATE trademarks SET image_url = ${url} WHERE id = ${m.id}`;
  }
  console.log(`\nwrote ${written} image URLs`);

  const check = await prisma.$queryRaw<Array<{ application_number: string; image_url: string }>>`
    SELECT application_number, image_url FROM trademarks WHERE image_url IS NOT NULL ORDER BY application_number`;
  console.log(`rows with an image_url: ${check.length}`);
  for (const r of check) {
    const ok = DEVICE_IMAGES[r.application_number] === r.image_url;
    console.log(`  ${ok ? 'ok  ' : 'MISMATCH '} ${r.application_number} ${r.image_url}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
