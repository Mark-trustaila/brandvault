'use client';

/**
 * Registry search results (docs/clearance-workflow.md §4).
 *
 * Tailwind only, per the CSS rule for new components.
 *
 * Two things changed when the engine review landed. The LawPanel `score` is the
 * only real similarity measure — 0 is identical and lower is closer — and the
 * `similarity` string is a bucketed edit distance with known bugs. So the table
 * leads on score and does not show similarity at all. Showing both invited a
 * reader to trust the word over the number, and the word is the less reliable
 * of the two.
 *
 * The rest is what a lawyer does with a result: tick rows, apply a tier, open a
 * hit to read the specification. Selection is transient and exists only to move
 * several rows at once; the tier is what persists.
 *
 * Four outcomes still render as themselves — running, completed with hits,
 * completed with none, and failed. A failure says the register was not
 * searched, never an empty list, because an empty list reads as "nothing
 * similar is registered", which is the opposite claim.
 */
import { useMemo, useState } from 'react';
import type { Coverage, SmartSearchResult } from '../../lib/smart-search';
import { hitMarkText, hitClassesLabel, truncationNotice, type SmartSearchHit } from '../../lib/smart-search-hit';
import { registryLabel, registryInProse } from '../../lib/smart-search-registries';
import {
  TIERS, TIER_LABEL, DEFAULT_TIER, isExactMatch, isLive, quickSelect, tierOf,
  type HitReview, type QuickSelectKind, type Tier,
} from '../../lib/clearance-review';

export type PanelState = {
  result: SmartSearchResult | null;
  polling: boolean;
  error: string | null;
  /** Saved judgement, keyed by application number. Empty for an unsaved run. */
  reviews?: Record<string, HitReview>;
  /** Apply a tier to these hits. Absent means the record is read-only. */
  onTier?: (applicationNumbers: string[], tier: Tier) => void;
  onOpenHit?: (hit: SmartSearchHit, index: number) => void;
};

const count = (n: number) => n.toLocaleString('en-GB');

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Banners({ currencyDate, coverage }: { currencyDate: string; coverage?: Coverage }) {
  const caveats = Object.values(coverage ?? {}).filter((c) => c?.partial);
  return (
    <div className="space-y-1 text-xs">
      <p className="text-slate-600">
        Register data <strong>as at {currencyDate || 'an unstated date'}</strong> — sourced from the registry, not assumed.
      </p>
      {caveats.map((c, i) => (
        <p key={i} className="text-amber-700">⚠ {c!.note}</p>
      ))}
    </div>
  );
}

const TIER_CHIP: Record<Tier, string> = {
  highlight: 'bg-amber-100 text-amber-900',
  appendix: 'bg-slate-100 text-slate-600',
  exclude: 'bg-slate-100 text-slate-400 line-through',
};

function HitRow({ hit, tier, checked, onCheck, onOpen }: {
  hit: SmartSearchHit;
  tier: Tier;
  checked: boolean;
  onCheck: (next: boolean) => void;
  onOpen?: () => void;
}) {
  const exact = isExactMatch(hit);
  return (
    <tr className={`border-t border-slate-100 align-top ${tier === 'exclude' ? 'opacity-50' : ''}`}>
      <td className="py-2 pl-3 pr-2">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${hit.application_number}`} />
      </td>
      <td className="py-2 pr-3">
        <span className="tabular-nums font-medium text-slate-900">{hit.score}</span>
        {/* Score 0 is the engine's identical match — the fact a clearance
            report opens by stating, so it is marked rather than left to spot. */}
        {exact && <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800">identical</span>}
      </td>
      <td className="py-2 pr-3">
        <button className="text-left font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600" onClick={onOpen}>
          {hitMarkText(hit) || '[no verbal element]'}
        </button>
        <div className="text-xs text-slate-500">{hit.owner ?? 'owner not recorded'}</div>
      </td>
      <td className="py-2 pr-3">
        <div className="text-slate-700">{hitClassesLabel(hit) || '—'}</div>
        {hit.class_match
          ? <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">class overlap</span>
          : <span className="mt-0.5 inline-block text-xs text-slate-400">no class overlap</span>}
      </td>
      <td className="py-2 pr-3 text-slate-700">
        {hit.status || '—'}
        {!isLive(hit) && <div className="text-xs text-slate-400">not live</div>}
      </td>
      <td className="py-2 pr-3">
        <div className="tabular-nums text-slate-700">{hit.application_number || '—'}</div>
        <div className="text-xs text-slate-500">{formatDate(hit.application_date)}</div>
      </td>
      <td className="py-2 pr-3">
        <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${TIER_CHIP[tier]}`}>{TIER_LABEL[tier]}</span>
      </td>
    </tr>
  );
}

/**
 * Quick-select and bulk tier. The only reason ticks exist.
 *
 * "Score under" is exclusive and means closer, not weaker — score is a
 * distance. The threshold is typed rather than fixed because what counts as
 * close depends on the term: a short word crowds the low scores, a long one
 * does not.
 */
function Toolbar({ hits, selected, setSelected, onTier }: {
  hits: SmartSearchHit[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  onTier?: (appNos: string[], tier: Tier) => void;
}) {
  const [threshold, setThreshold] = useState(20);
  const pick = (kind: QuickSelectKind) => setSelected(new Set(quickSelect(hits, kind, { scoreUnder: threshold })));
  const chosen = Array.from(selected);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
      <span className="text-slate-500">Select</span>
      <button className="rounded-md border border-line bg-surface px-2 py-1 hover:bg-surface-muted" onClick={() => pick('all')}>All</button>
      <button className="rounded-md border border-line bg-surface px-2 py-1 hover:bg-surface-muted" onClick={() => pick('live')}>Live only</button>
      <button className="rounded-md border border-line bg-surface px-2 py-1 hover:bg-surface-muted" onClick={() => pick('overlap')}>Class overlap</button>
      <span className="inline-flex items-center gap-1">
        <button className="rounded-md border border-line bg-surface px-2 py-1 hover:bg-surface-muted" onClick={() => pick('score')}>Score under</button>
        <input
          type="number" min={0} value={threshold} aria-label="Score threshold"
          className="w-16 rounded-md border border-line px-1 py-1"
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
      </span>
      <button className="rounded-md border border-line bg-surface px-2 py-1 hover:bg-surface-muted" onClick={() => pick('none')}>None</button>

      <span className="ml-auto text-slate-500">{chosen.length} selected</span>
      {/* Outline, like everything else here. Applying a tier is one of three
          equal choices, not the thing the screen wants you to do. */}
      {onTier && TIERS.map((t) => (
        <button
          key={t}
          disabled={chosen.length === 0}
          className="rounded-md border border-line bg-surface px-2 py-1 text-ink hover:bg-surface-muted disabled:opacity-40"
          onClick={() => { onTier(chosen, t); setSelected(new Set()); }}
        >
          {TIER_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

export default function ResultsPanel({ result, polling, error, reviews = {}, onTier, onOpenHit }: PanelState) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const hits = useMemo(() => result?.results ?? [], [result]);

  if (error) {
    return (
      <section className="rounded border border-red-200 bg-red-50 p-4">
        <h2 className="text-sm font-semibold text-red-800">The search could not be run</h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
        <p className="mt-1 text-xs text-red-700">
          Nothing was searched, so this is not a clear result. Try again, and tell us if it persists.
        </p>
      </section>
    );
  }

  if (!result) {
    if (polling) return <p className="text-sm text-slate-500">Submitting…</p>;
    return null;
  }

  if (result.status === 'running') {
    return (
      <section className="rounded border border-slate-200 p-4">
        <h2 className="text-sm font-semibold">Searching {registryInProse(result.registry)}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {result.term}{result.classes.length ? ` · class ${result.classes.join(', ')}` : ''} — this takes a few seconds.
        </p>
      </section>
    );
  }

  if (result.status === 'failed') {
    return (
      <section className="rounded border border-amber-300 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">
          The search of {registryInProse(result.registry)} did not run
        </h2>
        <p className="mt-1 text-sm text-amber-800">
          {result.failure_reason ?? 'The register did not return a result, and no reason was given.'}
        </p>
        <p className="mt-2 text-xs text-amber-800">
          {registryInProse(result.registry).replace(/^the/, 'The')} was not searched, so nothing here says whether{' '}
          {result.term} is clear in it. Run it again before relying on the outcome.
        </p>
        <div className="mt-3 border-t border-amber-200 pt-2">
          <Banners currencyDate={result.currencyDate} coverage={result.coverage} />
        </div>
      </section>
    );
  }

  const notice = truncationNotice(result);

  return (
    <section className="space-y-3">
      {/* What was searched. No hit count: the number is in the table and the
          record, and a headline count invites reading it as a finding. */}
      <div className="space-y-1">
        <p className="text-sm text-slate-700">
          <strong>{result.term}</strong> in {registryLabel(result.registry)}
          {result.classes.length ? `, class ${result.classes.join(', ')}` : ', all classes'}
        </p>
        <Banners currencyDate={result.currencyDate} coverage={result.coverage} />
      </div>

      {hits.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold">Nothing similar found in {registryInProse(result.registry)}</h2>
          <p className="mt-1 text-sm text-slate-600">
            {registryInProse(result.registry).replace(/^the/, 'The')} was searched and returned no similar marks. Read
            that against the currency date above — a mark filed since then would not appear. Other registers have not
            been searched.
          </p>
        </div>
      ) : (
        <>
          <Toolbar hits={hits} selected={selected} setSelected={setSelected} onTier={onTier} />
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium" />
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Mark and owner</th>
                  <th className="px-3 py-2 font-medium">Classes</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Application</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                </tr>
              </thead>
              <tbody>
                {/* The facade's own order: by score, exact matches first. Not
                    re-sorted here — score is a distance, and re-ranking on it
                    once put the least similar marks at the top. */}
                {hits.map((h, i) => (
                  <HitRow
                    key={h.application_number || i}
                    hit={h}
                    tier={tierOf(reviews, h.application_number) ?? DEFAULT_TIER}
                    checked={selected.has(h.application_number)}
                    onCheck={(next) => {
                      const s = new Set(selected);
                      if (next) s.add(h.application_number); else s.delete(h.application_number);
                      setSelected(s);
                    }}
                    onOpen={onOpenHit ? () => onOpenHit(h, i) : undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* One line, not a rubric. The cap is a fact about the search, and it
              belongs next to the list it truncated. */}
          {notice && (
            <p className="text-xs text-amber-800">
              {count(notice.shown)} shown;{' '}
              {notice.kind === 'known'
                ? `${count(notice.total)} matched.`
                : `the register returns at most ${notice.upstreamCap === null ? 'this many' : count(notice.upstreamCap)} per search.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}
