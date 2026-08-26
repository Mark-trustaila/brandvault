'use client';

/**
 * Clearance search — an arbitrary term, or a mark from the portfolio.
 *
 * New page: Tailwind only. Every facade call goes through /api/smart-search,
 * so the facade URL and both keys stay server-side and never reach the browser
 * (contract §4).
 *
 * Arrives prefilled from the detail panel's "Run clearance search":
 *   /clearance?term=ASOS&classes=25,35&mark_ref=UK00002530115
 * and can be reopened on a finished search by id:
 *   /clearance?search=<id>          ← the deep link a watch notice carries
 *
 * One-shot only, and inline: a clearance search is a question someone is
 * standing there waiting for, so the answer is this screen and nothing is
 * emitted to AiLA Core (§7). Watch recurrence is v1.x.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ResultsPanel from '../../components/clearance/ResultsPanel';
import { bvFetch } from '../../lib/client/acting-company';
import { pollDelayMs, shouldKeepPolling, timedOutMessage } from '../../lib/smart-search-poll';
import { normaliseClasses } from '../../lib/smart-search-classes';
import { clearanceArrival } from '../../lib/clearance-link';
import type { SmartSearchResult } from '../../lib/smart-search';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ClearanceSearch() {
  const params = useSearchParams();
  const [term, setTerm] = useState('');
  const [classes, setClasses] = useState('');
  const [markRef, setMarkRef] = useState<string | null>(null);
  const [result, setResult] = useState<SmartSearchResult | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Identifies the run whose results belong on screen. A second search started
  // while the first is still polling must not have the first one's late reply
  // land on top of it.
  const runId = useRef(0);

  /** Poll until settled, the cap passes, or a newer run supersedes this one. */
  const followSearch = useCallback(async (searchId: string, myRun: number) => {
    const startedAt = Date.now();
    for (let attempt = 1; ; attempt++) {
      const res = await bvFetch(`/api/smart-search/${encodeURIComponent(searchId)}`);
      if (runId.current !== myRun) return;
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `The facade returned HTTP ${res.status}.`);
        setPolling(false);
        return;
      }
      setResult(json as SmartSearchResult);
      if (!shouldKeepPolling(json?.status ?? 'running', Date.now() - startedAt)) {
        // Settled, or we have run out of patience. Only the second needs saying.
        if (json?.status === 'running') setError(timedOutMessage(searchId));
        setPolling(false);
        return;
      }
      await sleep(pollDelayMs(attempt));
      if (runId.current !== myRun) return;
    }
  }, []);

  const run = useCallback(async (t: string, c: string, ref: string | null) => {
    const trimmed = t.trim();
    if (trimmed.length < 2) { setError('Enter at least two characters to search.'); return; }
    const myRun = ++runId.current;
    setError(null); setResult(null); setPolling(true);

    const res = await bvFetch('/api/smart-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: trimmed, classes: normaliseClasses(c), markRef: ref }),
    });
    if (runId.current !== myRun) return;
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.search_id) {
      setError(json?.error ?? `The search could not be submitted (HTTP ${res.status}).`);
      setPolling(false);
      return;
    }
    await followSearch(json.search_id, myRun);
  }, [followSearch]);

  // Arrival: either an existing search to reopen, or a term to run.
  useEffect(() => {
    const arrival = clearanceArrival(params.toString());
    if (arrival.searchId) {
      const myRun = ++runId.current;
      setPolling(true);
      followSearch(arrival.searchId, myRun);
      return;
    }
    if (arrival.term) {
      const c = arrival.classes.join(', ');
      setTerm(arrival.term); setClasses(c); setMarkRef(arrival.markRef);
      run(arrival.term, c, arrival.markRef);
    }
    // Runs once per arrival URL; re-running on every state change would
    // resubmit the search on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const busy = polling;

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <a href="/" className="text-sm text-slate-500 hover:text-slate-700">← Dashboard</a>

      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Clearance search</h1>
        <p className="text-sm text-slate-600">
          Search the register for marks similar to a term, in the classes that matter. The similarity verdict is the
          register engine&apos;s own, not a BrandVault judgement.
        </p>
      </header>

      <section className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-[220px] flex-1 rounded border border-slate-300 p-2 text-sm"
            value={term}
            placeholder="Mark or term, e.g. ASOS"
            onChange={(e) => { setTerm(e.target.value); setMarkRef(null); }}
            onKeyDown={(e) => e.key === 'Enter' && !busy && run(term, classes, markRef)}
          />
          <input
            className="w-48 rounded border border-slate-300 p-2 text-sm"
            value={classes}
            placeholder="Classes, e.g. 25, 35"
            onChange={(e) => setClasses(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && run(term, classes, markRef)}
          />
          <button
            className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy || term.trim().length < 2}
            onClick={() => run(term, classes, markRef)}
          >
            {busy ? 'Searching…' : 'Run search'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {markRef
            ? `Run from ${markRef} — the result is recorded against that mark.`
            : 'Leave classes empty to search every class. A narrower class list gives a shorter, more useful list.'}
        </p>
      </section>

      <ResultsPanel result={result} polling={polling} error={error} />
    </main>
  );
}

export default function ClearancePage() {
  // useSearchParams needs a Suspense boundary to keep the route from opting the
  // whole page into client-side rendering at build.
  return (
    <Suspense fallback={<main className="p-6 text-sm text-slate-500">Loading…</main>}>
      <ClearanceSearch />
    </Suspense>
  );
}
