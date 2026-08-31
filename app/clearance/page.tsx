'use client';

/**
 * Registry search: the query box, the saved record, and the history
 * (docs/clearance-workflow.md §2, §6).
 *
 * Renders inside AppShell, so the sidebar, top bar and right rail persist and
 * only this content area changes. The route and the code identifiers stay
 * "clearance" — the word survives as the name of the report templates, and
 * renaming files would make the history harder to follow for no gain.
 *
 * Tailwind for this content area; every facade call goes through the server, so
 * the facade URL and both keys stay out of the browser.
 *
 * A search is a record from the moment it settles. `POST /api/clearance` runs
 * and saves it; this page then reads the record back and renders from that, so
 * a fresh run and a record reopened months later go through exactly the same
 * path and cannot drift.
 *
 * Arrives prefilled from a mark's "Check register":
 *   /clearance?term=ASOS&classes=25,35&mark_ref=UK00002530115&registry=gb
 * or reopens a saved record:
 *   /clearance?search=<record id>
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '../../components/layout/AppShell';
import ResultsPanel from '../../components/clearance/ResultsPanel';
import HitPanel from '../../components/clearance/HitPanel';
import ClearancesTable from '../../components/clearance/ClearancesTable';
import { bvFetch } from '../../lib/client/acting-company';
import { normaliseClasses } from '../../lib/smart-search-classes';
import { clearanceArrival } from '../../lib/clearance-link';
import { REGISTRIES, DEFAULT_REGISTRY, registryLabel, normaliseRegistry, type RegistryCode } from '../../lib/smart-search-registries';
import {
  recordAsResult, reviewMap, tierUpdates, type HistoryRow, type HitReview,
  type SavedRecordView, type Tier,
} from '../../lib/clearance-review';

function ClearanceSearch() {
  const params = useSearchParams();
  const [term, setTerm] = useState('');
  const [classes, setClasses] = useState('');
  const [registry, setRegistry] = useState<RegistryCode>(DEFAULT_REGISTRY);
  const [markRef, setMarkRef] = useState<string | null>(null);

  const [record, setRecord] = useState<SavedRecordView | null>(null);
  const [reviews, setReviews] = useState<Record<string, HitReview>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openHit, setOpenHit] = useState<number | null>(null);

  const loadHistory = useCallback(() => {
    bvFetch('/api/clearance')
      .then((r) => (r.ok ? r.json() : { searches: [] }))
      .then((j) => setHistory(j.searches ?? []))
      .catch(() => {});
  }, []);

  const loadRecord = useCallback(async (id: string) => {
    setError(null); setBusy(true); setOpenHit(null);
    const res = await bvFetch(`/api/clearance/${encodeURIComponent(id)}`);
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { setError(json?.error ?? `Could not open that search (HTTP ${res.status}).`); return; }
    setRecord(json.search);
    setReviews(reviewMap(json.reviews ?? []));
    setTerm(json.search.term);
    setClasses((json.search.classes ?? []).join(', '));
    setRegistry(normaliseRegistry(json.search.registry));
    setMarkRef(json.search.markRef);
  }, []);

  const run = useCallback(async (t: string, c: string, ref: string | null, reg: RegistryCode) => {
    const trimmed = t.trim();
    if (trimmed.length < 2) { setError('Enter at least two characters to search.'); return; }
    setError(null); setRecord(null); setReviews({}); setOpenHit(null); setBusy(true);

    const res = await bvFetch('/api/clearance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: trimmed, classes: normaliseClasses(c), markRef: ref, registry: reg }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.id) {
      setBusy(false);
      setError(json?.error ?? `The search could not be run (HTTP ${res.status}).`);
      return;
    }
    // Read the record back rather than rendering the response: what the lawyer
    // reviews is then what was actually stored.
    await loadRecord(json.id);
    loadHistory();
  }, [loadRecord, loadHistory]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    const arrival = clearanceArrival(params.toString());
    if (arrival.searchId) { loadRecord(arrival.searchId); return; }
    setRegistry(arrival.registry);
    if (arrival.term) {
      const c = arrival.classes.join(', ');
      setTerm(arrival.term); setClasses(c); setMarkRef(arrival.markRef);
      run(arrival.term, c, arrival.markRef, arrival.registry);
    }
    // Once per arrival URL; re-running on state changes would resubmit on every
    // keystroke — and a resubmit now costs a database row and a search budget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  /** Persist judgement, optimistically. The record is never touched. */
  const patchReviews = useCallback(async (updates: Array<{ applicationNumber: string; tier?: Tier; note?: string }>) => {
    if (!record || updates.length === 0) return;
    setReviews((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        const cur = next[u.applicationNumber] ?? { applicationNumber: u.applicationNumber, tier: 'appendix' as const };
        next[u.applicationNumber] = { ...cur, ...u };
      }
      return next;
    });
    const res = await bvFetch(`/api/clearance/${encodeURIComponent(record.id)}/hits`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    // Re-read on failure rather than leaving an optimistic lie on screen.
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error ?? 'That review did not save.');
      loadRecord(record.id);
    }
  }, [record, loadRecord]);

  const applyTier = useCallback((appNos: string[], tier: Tier) => {
    patchReviews(tierUpdates(appNos, tier, reviews));
  }, [patchReviews, reviews]);

  const hits = record && record.status !== 'failed' ? record.hits ?? [] : [];
  const result = record ? recordAsResult(record) : null;

  const hitPanel = openHit !== null && hits[openHit] && record ? (
    <HitPanel
      hit={hits[openHit]}
      registry={record.registry}
      index={openHit}
      total={hits.length}
      review={reviews[hits[openHit].application_number]}
      onClose={() => setOpenHit(null)}
      onPrev={openHit > 0 ? () => setOpenHit(openHit - 1) : undefined}
      onNext={openHit < hits.length - 1 ? () => setOpenHit(openHit + 1) : undefined}
      onReview={(patch) => patchReviews([{ applicationNumber: hits[openHit].application_number, ...patch }])}
    />
  ) : null;

  return (
    <AppShell overlay={hitPanel}>
      <div className="space-y-5">
        <header className="space-y-1">
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#37352f', marginBottom: 2 }}>Registry search</h1>
          <p style={{ fontSize: 12, color: '#9b9a97' }}>
            Search a register for marks similar to a term. Score is the engine&apos;s own measure of difference: 0 is
            identical and lower is closer.
          </p>
        </header>

        <section className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              className="min-w-[220px] flex-1 rounded-md border border-line p-2 text-sm"
              value={term}
              placeholder="Mark or term, e.g. ASOS"
              onChange={(e) => { setTerm(e.target.value); setMarkRef(null); }}
              onKeyDown={(e) => e.key === 'Enter' && !busy && run(term, classes, markRef, registry)}
            />
            <input
              className="w-44 rounded-md border border-line p-2 text-sm"
              value={classes}
              placeholder="Classes, e.g. 25, 35"
              onChange={(e) => setClasses(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && run(term, classes, markRef, registry)}
            />
            <select
              className="w-52 rounded-md border border-line bg-surface p-2 text-sm"
              value={registry}
              aria-label="Register to search"
              onChange={(e) => setRegistry(normaliseRegistry(e.target.value))}
            >
              {REGISTRIES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
            {/* The app's standard button: outline, not filled. No view here
                claims the single filled button. */}
            <button
              className="rounded-md border border-line bg-surface px-3.5 py-1.5 text-xs text-ink hover:bg-surface-muted disabled:opacity-40"
              disabled={busy || term.trim().length < 2}
              onClick={() => run(term, classes, markRef, registry)}
            >
              {busy ? 'Searching…' : 'Run search'}
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            {markRef
              ? `Run from ${markRef} against ${registryLabel(registry)} — the result is recorded against that mark.`
              : `Searching ${registryLabel(registry)}. Leave classes empty to search every class; a narrower class list gives a shorter, more useful list.`}
            {' '}A search takes about half a minute and is saved when it finishes.
          </p>
        </section>

        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <ResultsPanel
          result={result as any}
          polling={busy}
          error={null}
          reviews={reviews}
          onTier={record ? applyTier : undefined}
          onOpenHit={(_h, i) => setOpenHit(i)}
        />

        <ClearancesTable rows={history} currentId={record?.id ?? null} onOpen={(id) => loadRecord(id)} />
      </div>
    </AppShell>
  );
}

export default function ClearancePage() {
  return (
    <Suspense fallback={<AppShell><p className="text-sm text-ink-muted">Loading…</p></AppShell>}>
      <ClearanceSearch />
    </Suspense>
  );
}
