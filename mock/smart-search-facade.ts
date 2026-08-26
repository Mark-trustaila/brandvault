/**
 * Local mock of the Smart Search facade — §3 of
 * docs/smart-search-facade-contract-v1.md, and nothing else.
 *
 * Disposable by design. The contract is the interface; this is a stand-in that
 * lets Unit B be built, run and tested before Unit A deploys, exactly as the
 * portfolio-import client was built against a local mock first. When Mark hands
 * over the deployed facade URL and key, the swap is one env var and this file
 * can be deleted without touching a line of lib/, app/ or components/.
 *
 *   npm run mock:smart-search              # listens on 8787
 *   SMART_SEARCH_FACADE_URL=http://localhost:8787 \
 *   SMART_SEARCH_FACADE_KEY=dev SMART_SEARCH_FACADE_FN_KEY=dev npm run dev
 *
 * It is deliberately unhelpful in two ways, because a mock that is nicer than
 * the real thing hides the work:
 *
 *   - Auth is enforced. Both headers must be present and non-empty on every
 *     call but /smart-search/health. A client that forgets one fails here
 *     rather than in production.
 *   - Searches take time. A submit is `running` for MOCK_POLLS polls (default
 *     2) before it settles, so the polling loop is exercised rather than
 *     accidentally skipped by an instant answer.
 *
 * Deterministic triggers, so a state can be reached on purpose:
 *   term containing "fail"    → status "failed" with a reason (§3.3)
 *   term containing "nothing" → completed with zero hits
 *   anything else             → completed with a spread of similarity verdicts
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const POLLS_BEFORE_SETTLED = Number(process.env.MOCK_POLLS ?? 2);

// Fixed values a real facade sources from the registry. Same shape as the
// registry facade sends, so the banner component is exercised for real.
const CURRENCY_DATE = process.env.MOCK_CURRENCY_DATE ?? '2026-07-11';
const COVERAGE = {
  uk009: {
    partial: true,
    approxPct: 72,
    note: 'UK009 (Brexit comparable) coverage is corpus-wide ~72% pending the UKIPO baseline ingest; absence of a UK009 mark is not proof of non-existence.',
  },
};

type Search = {
  id: string;
  term: string;
  classes: string[];
  registry: string;
  markRef: string | null;
  polls: number;
};

const searches = new Map<string, Search>();

/**
 * Hits for a term. Shaped from the term so two searches never look identical,
 * and spread across the similarity vocabulary so the panel has every verdict,
 * a class match and a non-match, a registered mark and a pending one, and a
 * hit with no owner recorded — the cases that break a results table.
 */
function hitsFor(term: string, classes: string[]): any[] {
  const t = term.trim().toUpperCase();
  if (/nothing/i.test(term)) return [];
  const cls = classes.length ? classes.join(',') : '35';
  return [
    {
      id: randomUUID(), score: 92, similarity: 'Very high', class_match: 1,
      application_number: 'UK00004300780', classes: cls, status: 'Registered',
      mark_string: t, registry: 'gb', registry_official_name: 'UKIPO',
      is_registered: true, application_date: '2025-11-25', owner: 'Bloc Services Group Limited', mark_id: 0,
    },
    {
      id: randomUUID(), score: 74, similarity: 'Very high', class_match: 0,
      application_number: 'UK00003991221', classes: '9,42', status: 'Registered',
      mark_string: `${t} LABS`, registry: 'gb', registry_official_name: 'UKIPO',
      is_registered: true, application_date: '2023-04-02', owner: null, mark_id: 0,
    },
    {
      id: randomUUID(), score: 51, similarity: 'High', class_match: 1,
      application_number: 'UK00004411907', classes: cls, status: 'Application published',
      mark_string: `${t}O`, registry: 'gb', registry_official_name: 'UKIPO',
      is_registered: false, application_date: '2026-02-18', owner: 'Northgate Holdings Ltd', mark_id: 0,
    },
    {
      id: randomUUID(), score: 23, similarity: 'Low', class_match: 0,
      application_number: 'UK00900412330', classes: '25', status: 'Registered',
      mark_string: `${t.slice(0, 3)}TEC`, registry: 'gb', registry_official_name: 'UKIPO',
      is_registered: true, application_date: '2004-09-30', owner: 'Assorted Textiles SA', mark_id: 0,
    },
  ];
}

function body(res: any, status: number, payload: unknown) {
  const json = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

const readJson = (req: any): Promise<any> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve(null); } });
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/$/, '');
  const method = req.method ?? 'GET';

  // §3.3 health — anonymous.
  if (method === 'GET' && path === '/smart-search/health') {
    return body(res, 200, { reachable: true, currencyDate: CURRENCY_DATE, coverage: COVERAGE });
  }

  if (!req.headers['x-brandvault-key'] || !req.headers['x-functions-key']) {
    return body(res, 401, { error: { code: 'UNAUTHORISED', message: 'x-brandvault-key and x-functions-key are both required' } });
  }

  // §3.1 submit.
  const submit = path.match(/^\/smart-search\/([a-z]{2})\/search$/);
  if (method === 'POST' && submit) {
    const payload = await readJson(req);
    const term = typeof payload?.term === 'string' ? payload.term.trim() : '';
    if (!term) return body(res, 400, { error: { code: 'BAD_REQUEST', message: 'term is required' } });
    const registry = submit[1];
    if (registry !== 'gb' && registry !== 'wo') {
      return body(res, 501, { error: { code: 'REGISTRY_NOT_IMPLEMENTED', message: `registry ${registry} is not implemented` } });
    }
    const id = randomUUID();
    searches.set(id, {
      id, term, registry,
      classes: Array.isArray(payload?.classes) ? payload.classes.map(String) : [],
      markRef: payload?.mark_ref ?? null,
      polls: 0,
    });
    console.log(`[mock] submit ${id} term=${JSON.stringify(term)} classes=${JSON.stringify(payload?.classes ?? [])} mark_ref=${payload?.mark_ref ?? '—'}`);
    return body(res, 200, { search_id: id, status: 'running' });
  }

  // §3.2 poll.
  const poll = path.match(/^\/smart-search\/([^/]+)$/);
  if (method === 'GET' && poll) {
    const search = searches.get(poll[1]);
    if (!search) return body(res, 404, { error: { code: 'SEARCH_NOT_FOUND', message: 'unknown search id' } });
    search.polls += 1;

    const envelope = {
      search_id: search.id,
      term: search.term,
      classes: search.classes,
      registry: search.registry,
      currencyDate: CURRENCY_DATE,
      coverage: COVERAGE,
      mark_ref: search.markRef,
    };

    if (search.polls <= POLLS_BEFORE_SETTLED) {
      return body(res, 200, { ...envelope, status: 'running', results: null, failure_reason: null });
    }
    if (/fail/i.test(search.term)) {
      return body(res, 200, {
        ...envelope, status: 'failed', results: null,
        failure_reason: 'The search worker did not return a result within the allowed time. The register was not searched.',
      });
    }
    return body(res, 200, {
      ...envelope, status: 'completed', failure_reason: null,
      results: hitsFor(search.term, search.classes),
    });
  }

  body(res, 404, { error: { code: 'NOT_FOUND', message: `no route for ${method} ${path}` } });
});

server.listen(PORT, () => {
  console.log(`[mock] Smart Search facade on http://localhost:${PORT}`);
  console.log(`[mock] settles after ${POLLS_BEFORE_SETTLED} poll(s); "fail" in a term fails, "nothing" returns no hits`);
});
