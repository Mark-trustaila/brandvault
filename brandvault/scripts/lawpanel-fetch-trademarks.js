#!/usr/bin/env node
/**
 * LawPanel Trademark Fetch Script
 * ================================
 * Fetches trademark portfolio data from the LawPanel Firms API
 * and writes it to public/trademark-data.json.
 *
 * Usage:
 *   LAWPANEL_USER=tmd LAWPANEL_KEY=8ebca984-... node scripts/lawpanel-fetch-trademarks.js
 *
 * Environment variables:
 *   LAWPANEL_USER  – LawPanel username (e.g. "tmd" or "trade mark direct")
 *   LAWPANEL_KEY   – Ocp-Apim-Subscription-Key
 *   LAWPANEL_PASS  – Password (if required by your account)
 *
 * The script authenticates, then pages through /firms/firmportfolio
 * collecting all trademarks. It filters for Yoti / Yoti Holdings marks
 * and writes the result as JSON.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = 'https://api.lawpanel.com/v1/firms';
const PAGE_SIZE = 100; // max allowed by API

const USER = process.env.LAWPANEL_USER;
const KEY  = process.env.LAWPANEL_KEY;
const PASS = process.env.LAWPANEL_PASS || '';

if (!USER || !KEY) {
  console.error('Error: set LAWPANEL_USER and LAWPANEL_KEY environment variables.');
  console.error('Example: LAWPANEL_USER=tmd LAWPANEL_KEY=8ebca984-... node scripts/lawpanel-fetch-trademarks.js');
  process.exit(1);
}

/* ── HTTP helper ─────────────────────────────────────────────── */
function request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Ocp-Apim-Subscription-Key': KEY,
        ...headers,
      },
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: raw,
          cookies: (res.headers['set-cookie'] || []).join('; '),
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ── Main ────────────────────────────────────────────────────── */
async function main() {
  console.log('🔑  Authenticating with LawPanel...');

  // Step 1: Login to get auth cookie
  const loginRes = await request('POST', `${BASE}/login`, {
    body: JSON.stringify({ username: USER, password: PASS }),
  });

  if (loginRes.status !== 200) {
    // Some accounts may use a different auth flow — try with cookie header directly
    console.warn(`⚠️  Login returned ${loginRes.status}. Trying subscription-key-only auth...`);
  }

  const cookie = loginRes.cookies || '';
  console.log(cookie ? '✅  Got auth cookie.' : '⚠️  No cookie returned — continuing with subscription key only.');

  // Step 2: Page through firmportfolio
  let allTrademarks = [];
  let skip = 0;
  let page = 1;

  while (true) {
    const url = `${BASE}/firmportfolio?take=${PAGE_SIZE}&skip=${skip}`;
    console.log(`📄  Fetching page ${page} (skip=${skip})...`);

    const res = await request('GET', url, {
      headers: cookie ? { cookie } : {},
    });

    if (res.status !== 200) {
      console.error(`❌  API returned ${res.status}: ${res.body.substring(0, 300)}`);
      break;
    }

    let records;
    try {
      records = JSON.parse(res.body);
    } catch (e) {
      console.error('❌  Failed to parse JSON response.');
      break;
    }

    if (!Array.isArray(records) || records.length === 0) {
      console.log('   No more records.');
      break;
    }

    allTrademarks = allTrademarks.concat(records);
    console.log(`   Got ${records.length} records (total so far: ${allTrademarks.length})`);

    if (records.length < PAGE_SIZE) break; // last page
    skip += PAGE_SIZE;
    page++;
  }

  console.log(`\n📊  Total trademarks fetched: ${allTrademarks.length}`);

  // Step 3: Filter for Yoti / Yoti Holdings
  // Adjust this filter if the owner info is in a different field
  const yotiMarks = allTrademarks.filter((tm) => {
    const agent = (tm.client_agent_name || '').toLowerCase();
    const mark = (tm.mark_text || '').toLowerCase();
    const notes = (tm.notes || '').toLowerCase();
    return (
      agent.includes('yoti') ||
      mark.includes('yoti') ||
      notes.includes('yoti') ||
      notes.includes('yoti holdings')
    );
  });

  console.log(`🔍  Yoti/Yoti Holdings trademarks: ${yotiMarks.length}`);

  // If no Yoti filter matches, save all (user may need to adjust filter)
  const output = yotiMarks.length > 0 ? yotiMarks : allTrademarks;
  if (yotiMarks.length === 0) {
    console.log('⚠️  No Yoti marks found — saving ALL trademarks. Check the filter logic.');
    console.log('   Sample agent names:', [...new Set(allTrademarks.slice(0, 10).map(t => t.client_agent_name))].join(', '));
  }

  // Step 4: Write to JSON
  const outPath = path.join(__dirname, '..', 'public', 'trademark-data.json');
  const wrapper = {
    fetchedAt: new Date().toISOString(),
    count: output.length,
    source: 'LawPanel Firms API',
    trademarks: output,
  };

  fs.writeFileSync(outPath, JSON.stringify(wrapper, null, 2));
  console.log(`\n✅  Written to ${outPath}`);

  // Summary
  const registries = [...new Set(output.map((t) => t.registry_name))];
  const statuses = [...new Set(output.map((t) => t.status))];
  const marks = [...new Set(output.map((t) => t.mark_text))];
  console.log(`\n📋  Summary:`);
  console.log(`   Unique marks: ${marks.length} — ${marks.slice(0, 10).join(', ')}${marks.length > 10 ? '...' : ''}`);
  console.log(`   Registries: ${registries.join(', ')}`);
  console.log(`   Statuses: ${statuses.join(', ')}`);
}

main().catch((err) => {
  console.error('💥  Fatal error:', err.message);
  process.exit(1);
});
