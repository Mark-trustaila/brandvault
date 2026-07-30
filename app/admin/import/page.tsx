'use client';
import { useEffect, useMemo, useState } from 'react';

/**
 * Concierge portfolio import (platform-admin). Company → owner search →
 * checkboxes → preview → confirm. New page: Tailwind only. All registry/DB work
 * is server-side behind /api/admin/import/* (facade secrets never reach here).
 * docs/portfolio-import-admin-proposal.md.
 */

type Company = { id: string; name: string; slug: string; trademarkCount: number; linked?: boolean };
type Owner = { ownerString: string; matchedVia: Array<'owner' | 'representative'>; markCount: number };
type SearchResult = { owners: Owner[]; totalDistinctMarks: number; cap: number; currencyDate: string; coverage: Coverage };
type Coverage = { uk009: { partial: boolean; approxPct: number; note: string } };
type Preview = {
  currencyDate: string; coverage: Coverage;
  predicted: { marks: number; goodsServices: number; deadlines: number };
  plan: { toInsert: number; toUpdate: number; staleCount: number; stale: string[] };
  byStatus: Record<string, number>; bySeries: Record<string, number>;
  sample: Array<{ applicationNumber: string; markText: string; status: string; registryStatusRaw: string; seriesPrefix: string }>;
};
type ImportRow = {
  id: string; registryName: string; ownerStrings: string[]; currencyDate: string | null;
  status: string; predicted: any; actual: any; plan: any; pruned: boolean; createdBy: string | null; createdAt: string;
};

async function jpost(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function Banners({ currencyDate, coverage }: { currencyDate: string; coverage: Coverage }) {
  return (
    <div className="space-y-1 text-xs">
      <p className="text-slate-600">UK registry data <strong>as at {currencyDate}</strong> — sourced from the registry, not assumed.</p>
      {coverage?.uk009?.partial && (
        <p className="text-amber-700">⚠ {coverage.uk009.note}</p>
      )}
      <p className="text-slate-500">Live marks only — imported portfolios carry no dead/expired-mark history.</p>
    </div>
  );
}

export default function ImportPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [slug, setSlug] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const [prune, setPrune] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<ImportRow[]>([]);
  // create-new-company state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((d) => setIsAdmin(Boolean(d.isPlatformAdmin))).catch(() => setIsAdmin(false));
    fetch('/api/admin/companies').then((r) => (r.ok ? r.json() : { companies: [] })).then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!slug) { setHistory([]); return; }
    fetch(`/api/admin/import/history?company=${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : { imports: [] })).then((d) => setHistory(d.imports ?? [])).catch(() => {});
  }, [slug, result]);

  const cap = search?.cap ?? 2000;
  const selectedOverCap = useMemo(() => (search?.owners ?? []).filter((o) => selected.has(o.ownerString) && o.markCount > cap), [search, selected, cap]);

  function reset(soft = false) {
    setPreview(null); setResult(null); setError(null);
    if (!soft) { setSelected(new Set()); setSearch(null); }
  }

  // Create a company (unlinked — org link is a later onboarding step) and
  // select it, so create → search → import is one uninterrupted flow.
  async function doCreate() {
    const name = newName.trim();
    if (!name) { setError('company name is required'); return; }
    setError(null); setBusy('create');
    const { ok, status, json } = await jpost('/api/admin/companies', { name, slug: newSlug.trim() || undefined });
    setBusy(null);
    if (!ok) { setError(status === 409 ? 'That slug is already taken — pick another.' : (json.error ?? 'create failed')); return; }
    const c: Company = { id: json.id, name: json.name, slug: json.slug, trademarkCount: json.trademarkCount ?? 0, linked: false };
    setCompanies((prev) => [c, ...prev]);
    setSlug(c.slug); // select the new company; the search step appears next
    setShowCreate(false); setNewName(''); setNewSlug(''); setSlugTouched(false);
    reset();
  }

  async function doSearch() {
    if (!slug) { setError('Select a company first.'); return; } // never search unscoped
    reset(); setBusy('search');
    const { ok, json } = await jpost('/api/admin/import/search-owner', { query });
    setBusy(null);
    if (!ok) { setError(json.error ?? 'search failed'); return; }
    setSearch(json);
    // Default: owner matches checked, representative-only unchecked.
    setSelected(new Set((json.owners as Owner[]).filter((o) => o.matchedVia.includes('owner')).map((o) => o.ownerString)));
  }

  function toggle(owner: string) {
    setPreview(null); setResult(null);
    setSelected((prev) => { const next = new Set(prev); next.has(owner) ? next.delete(owner) : next.add(owner); return next; });
  }

  async function doPreview() {
    setError(null); setResult(null); setBusy('preview');
    const { ok, status, json } = await jpost('/api/admin/import/preview', { companySlug: slug, ownerStrings: Array.from(selected), pruneAbsent: prune });
    setBusy(null);
    if (!ok) { setError(status === 413 ? `Too large: ${json.matchedDistinctMarks} marks exceed the ${json.cap} cap — contact us.` : (json.error ?? 'preview failed')); return; }
    setPreview(json);
  }

  async function doExecute() {
    if (!reason.trim()) { setError('a reason is required'); return; }
    if (!confirm(`Import ${preview?.predicted.marks} marks into ${slug}? This writes to the portfolio.`)) return;
    setError(null); setBusy('execute');
    const { ok, json } = await jpost('/api/admin/import/execute', { companySlug: slug, ownerStrings: Array.from(selected), pruneAbsent: prune, reason });
    setBusy(null);
    if (!ok) { setError(json.error ?? 'import failed'); return; }
    setResult(json); setPreview(null);
  }

  if (isAdmin === null) return <main className="p-8 text-slate-500">Loading…</main>;
  if (!isAdmin) return <main className="p-8"><h1 className="text-lg font-semibold">Portfolio import</h1><p className="mt-2 text-red-600">Platform admin only.</p></main>;

  const selectedList = Array.from(selected);
  const selectedCompany = companies.find((c) => c.slug === slug);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Portfolio import (concierge)</h1>
        <p className="text-sm text-slate-500">Search the UK register by proprietor and import a client's real portfolio.</p>
      </header>

      {/* 1. company — select an existing one or create a new one, then populate */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium">Company</label>
          <button className="text-xs text-slate-600 underline" onClick={() => { setShowCreate((v) => !v); setError(null); }}>
            {showCreate ? 'cancel' : '+ New company'}
          </button>
        </div>

        {showCreate ? (
          <div className="space-y-2 rounded border border-slate-200 p-3">
            <input className="w-full rounded border border-slate-300 p-2 text-sm" placeholder="Company name" value={newName}
              onChange={(e) => { setNewName(e.target.value); if (!slugTouched) setNewSlug(slugify(e.target.value)); }} />
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">slug</span>
              <input className="flex-1 rounded border border-slate-300 p-1.5 font-mono text-sm" value={newSlug}
                onChange={(e) => { setNewSlug(slugify(e.target.value)); setSlugTouched(true); }} />
              <button className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                disabled={!newName.trim() || busy === 'create'} onClick={doCreate}>
                {busy === 'create' ? 'Creating…' : 'Create & select'}
              </button>
            </div>
            <p className="text-xs text-slate-500">A company can be created and populated before any user org is linked.</p>
          </div>
        ) : (
          <select className="w-full rounded border border-slate-300 p-2 text-sm" value={slug} onChange={(e) => { setSlug(e.target.value); reset(); }}>
            <option value="">— select a company —</option>
            {companies.map((c) => <option key={c.id} value={c.slug}>{c.name} ({c.trademarkCount} marks){c.linked === false ? ' · no org' : ''}</option>)}
          </select>
        )}

        {selectedCompany && selectedCompany.linked === false && (
          <p className="text-xs text-amber-700">No user access yet — link a Clerk organisation when onboarding users.</p>
        )}
      </section>

      {/* 2. owner search — gated on a company being selected */}
      <section className="space-y-2">
        <label className="block text-sm font-medium">Search proprietor</label>
        <div className="flex gap-2">
          <input className="flex-1 rounded border border-slate-300 p-2 text-sm" value={query} placeholder="e.g. ASOS"
            onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && slug && query.trim().length >= 2 && doSearch()} />
          <button className="rounded bg-slate-800 px-4 text-sm text-white disabled:opacity-50" disabled={!slug || query.trim().length < 2 || busy === 'search'} onClick={doSearch}>
            {busy === 'search' ? 'Searching…' : 'Search'}
          </button>
        </div>
        {!slug && <p className="text-xs text-slate-500">Select or create a company first — search is scoped to the company you&apos;re populating.</p>}
      </section>

      {/* 3. owner checkboxes */}
      {search && (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Owners ({search.totalDistinctMarks} distinct marks)</h2>
          </div>
          <Banners currencyDate={search.currencyDate} coverage={search.coverage} />
          <ul className="divide-y rounded border border-slate-200">
            {search.owners.map((o) => {
              const isRepOnly = !o.matchedVia.includes('owner');
              const over = o.markCount > cap;
              return (
                <li key={o.ownerString} className="flex items-center gap-3 p-2 text-sm">
                  <input type="checkbox" disabled={over} checked={selected.has(o.ownerString)} onChange={() => toggle(o.ownerString)} />
                  <span className={isRepOnly ? 'text-slate-500' : 'font-medium'}>{o.ownerString}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${isRepOnly ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800'}`}>
                    {isRepOnly ? 'representative' : 'owner'}
                  </span>
                  <span className="ml-auto text-xs text-slate-500">{o.markCount} marks{over ? ' — too large, contact us' : ''}</span>
                </li>
              );
            })}
          </ul>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={prune} onChange={(e) => { setPrune(e.target.checked); setPreview(null); }} />
            Prune marks no longer in the registry result (deletes them — otherwise kept and reported)
          </label>
          <button className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!selectedList.length || selectedOverCap.length > 0 || busy === 'preview'} onClick={doPreview}>
            {busy === 'preview' ? 'Previewing…' : `Preview import (${selectedList.length} selected)`}
          </button>
        </section>
      )}

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {/* 4. preview */}
      {preview && (
        <section className="space-y-3 rounded border border-slate-200 p-4">
          <h2 className="text-sm font-semibold">Preview</h2>
          <Banners currencyDate={preview.currencyDate} coverage={preview.coverage} />
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="marks" value={preview.predicted.marks} />
            <Stat label="goods/services" value={preview.predicted.goodsServices} />
            <Stat label="deadlines" value={preview.predicted.deadlines} />
          </div>
          <p className="text-xs text-slate-600">
            Plan: <strong>{preview.plan.toInsert}</strong> new · <strong>{preview.plan.toUpdate}</strong> refreshed in place ·{' '}
            <strong>{preview.plan.staleCount}</strong> already held not in this result {prune ? '(will be deleted)' : '(kept)'}
          </p>
          <div className="flex flex-wrap gap-1 text-xs">
            {Object.entries(preview.byStatus).map(([k, v]) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5">{k}: {v}</span>)}
          </div>
          <div className="flex flex-wrap gap-1 text-xs">
            {Object.entries(preview.bySeries).map(([k, v]) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5">{k}: {v}</span>)}
          </div>
          <details className="text-xs"><summary className="cursor-pointer text-slate-500">Sample marks</summary>
            <ul className="mt-1 space-y-0.5">
              {preview.sample.map((m) => <li key={m.applicationNumber} className="text-slate-600">{m.applicationNumber} · {m.markText} · {m.registryStatusRaw}</li>)}
            </ul>
          </details>
          <div className="space-y-2 border-t pt-3">
            <input className="w-full rounded border border-slate-300 p-2 text-sm" placeholder="Reason (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy === 'execute' || !reason.trim()} onClick={doExecute}>
              {busy === 'execute' ? 'Importing…' : `Confirm import → ${slug}`}
            </button>
          </div>
        </section>
      )}

      {/* 5. result */}
      {result && (
        <section className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm">
          <p className="font-medium text-emerald-800">✓ Imported and verified.</p>
          <p className="text-emerald-700">{result.actual.marks} marks · {result.actual.goodsServices} goods/services · {result.actual.deadlines} deadlines. Import {result.importId}.</p>
        </section>
      )}

      {/* 6. history */}
      {slug && history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Import history</h2>
          <table className="w-full text-xs">
            <thead><tr className="text-left text-slate-500"><th className="py-1">when</th><th>owners</th><th>as at</th><th>status</th><th>marks</th><th>by</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="py-1">{new Date(h.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{(h.ownerStrings ?? []).join(', ')}</td>
                  <td>{h.currencyDate ?? '—'}</td>
                  <td>{h.status}</td>
                  <td>{h.actual?.marks ?? h.predicted?.marks ?? '—'}</td>
                  <td className="text-slate-400">{h.createdBy?.slice(0, 8) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded bg-slate-50 p-2"><div className="text-lg font-semibold">{value}</div><div className="text-xs text-slate-500">{label}</div></div>;
}
