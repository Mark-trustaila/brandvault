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
  highlightRank, type HitReview, type QuickSelectKind, type Tier,
} from '../../lib/clearance-review';

export type PanelState = {
  result: SmartSearchResult | null;
  polling: boolean;
  error: string | null;
  /** Saved judgement, keyed by application number. Empty for an unsaved run. */
  reviews?: Record<string, HitReview>;
  /** Apply a tier to these hits. Absent means the record is read-only. */
  onTier?: (applicationNumbers: string[], tier: Tier) => void;
  /** Move one mark up or down the highlight tier. */
  onReorder?: (applicationNumber: string, direction: 'up' | 'down') => void;
  /** Drop the chosen order and fall back to the engine's. */
  onClearOrder?: () => void;
  onOpenHit?: (hit: SmartSearchHit, index: number) => void;
};

const count = (n: number) => n.toLocaleString('en-GB');

/** Quick-select button. flex-none so nothing in the toolbar can be squeezed. */
const QS = 'flex-none whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 hover:bg-surface-muted';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The currency line, and only that.
 *
 * The UK009 partial-coverage caveat used to sit here, above every result set.
 * It is a standing fact about the GB corpus, not a finding about this search,
 * and repeating it over each one taught readers to scroll past it. It now
 * appears once, in the right rail's data-source block beside the dashboard's
 * own data note, and slice 2 carries it into the report disclaimer — where a
 * reader is deciding something and a caveat is worth reading.
 */
export function Banners({ currencyDate }: { currencyDate: string; coverage?: Coverage }) {
  return (
    <div className="space-y-1 text-xs">
      <p className="text-slate-600">
        Register data <strong>as at {currencyDate || 'an unstated date'}</strong> — sourced from the registry, not assumed.
      </p>
    </div>
  );
}

const TIER_CHIP: Record<Tier, string> = {
  highlight: 'bg-amber-100 text-amber-900',
  appendix: 'bg-slate-100 text-slate-600',
  exclude: 'bg-slate-100 text-slate-400 line-through',
};

function HitRow({ hit, tier, rank, checked, onCheck, onOpen, onReorder, canMoveUp, canMoveDown }: {
  hit: SmartSearchHit;
  tier: Tier;
  /** Position in the highlight tier, 1-based; null outside it. */
  rank: number | null;
  checked: boolean;
  onCheck: (next: boolean) => void;
  onOpen?: () => void;
  onReorder?: (direction: 'up' | 'down') => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const exact = isExactMatch(hit);
  return (
    <tr className={`border-t border-slate-100 align-top ${tier === 'exclude' ? 'opacity-50' : ''}`}>
      <td className="py-2 pl-3 pr-2">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${hit.application_number}`} />
      </td>
      <td className="py-2 pr-3">
        <div className="tabular-nums font-medium text-slate-900">{hit.score}</div>
        {/* Score 0 is the engine's identical match — the fact a clearance
            report opens by stating, so it is marked rather than left to spot.
            Below the number, not beside it: beside it, the chip set the
            column's width. */}
        {exact && <span className="mt-0.5 inline-block rounded bg-rose-100 px-1 py-0.5 text-[10px] text-rose-800">identical</span>}
      </td>
      <td className="py-2 pr-3">
        <button className="break-words text-left font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600" onClick={onOpen}>
          {hitMarkText(hit) || '[no verbal element]'}
        </button>
        <div className="break-words text-xs text-slate-500">{hit.owner ?? 'owner not recorded'}</div>
      </td>
      <td className="py-2 pr-3">
        <div className="break-words text-slate-700">{hitClassesLabel(hit) || '—'}</div>
        {hit.class_match
          ? <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">class overlap</span>
          : <span className="mt-0.5 inline-block text-xs text-slate-400">no class overlap</span>}
      </td>
      <td className="py-2 pr-3 text-slate-700">
        {hit.status || '—'}
        {!isLive(hit) && <div className="text-xs text-slate-400">not live</div>}
      </td>
      <td className="py-2 pr-3">
        <div className="break-words tabular-nums text-slate-700">{hit.application_number || '—'}</div>
        <div className="text-xs text-slate-500">{formatDate(hit.application_date)}</div>
      </td>
      <td className="py-2 pr-3">
        <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${TIER_CHIP[tier]}`}>
          {TIER_LABEL[tier]}{rank !== null && ` ${rank}`}
        </span>
        {/* Only the highlight tier has an order, because only it has a reader:
            the report's front table argues these marks in this sequence. The
            list itself stays in the engine's order, so the rank is where the
            move shows rather than the row jumping under the cursor. */}
        {rank !== null && onReorder && (
          <div className="mt-1 flex gap-1">
            <button
              className="rounded border border-line bg-surface px-1 leading-none text-ink-muted hover:bg-surface-muted disabled:opacity-30"
              onClick={() => onReorder('up')} disabled={!canMoveUp} aria-label={`Move ${hit.application_number} up`}
            >▲</button>
            <button
              className="rounded border border-line bg-surface px-1 leading-none text-ink-muted hover:bg-surface-muted disabled:opacity-30"
              onClick={() => onReorder('down')} disabled={!canMoveDown} aria-label={`Move ${hit.application_number} down`}
            >▼</button>
          </div>
        )}
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
    // flex-nowrap, so it is one line by construction rather than by luck: at a
    // narrow window it scrolls sideways instead of silently becoming two rows
    // and pushing the table down. Labels are short for the same reason.
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto rounded border border-line bg-surface-muted p-2 text-xs">
      <button className={QS} onClick={() => pick('all')}>All</button>
      <button className={QS} onClick={() => pick('live')}>Live</button>
      <button className={QS} onClick={() => pick('overlap')}>Overlap</button>
      <span className="inline-flex flex-none items-center gap-1">
        <button className={QS} onClick={() => pick('score')}>Score under</button>
        <input
          type="number" min={0} value={threshold} aria-label="Score threshold"
          className="w-14 flex-none rounded-md border border-line px-1 py-1"
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
      </span>
      <button className={QS} onClick={() => pick('none')}>None</button>

      <span className="ml-auto flex-none whitespace-nowrap text-ink-muted">{chosen.length} selected</span>
      {/* One control rather than three buttons. Bulk tiering is the only reason
          the ticks exist, so it stays — it just stops costing three widths. */}
      {onTier && (
        <select
          className="flex-none rounded-md border border-line bg-surface px-2 py-1 text-ink disabled:opacity-40"
          aria-label="Apply tier to selected"
          disabled={chosen.length === 0}
          value=""
          onChange={(e) => {
            const t = e.target.value as Tier;
            if (!t) return;
            onTier(chosen, t);
            setSelected(new Set());
            e.target.value = '';
          }}
        >
          <option value="">Apply tier…</option>
          {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
        </select>
      )}
    </div>
  );
}

export default function ResultsPanel({ result, polling, error, reviews = {}, onTier, onReorder, onClearOrder, onOpenHit }: PanelState) {
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
  const highlightCount = hits.filter((h) => tierOf(reviews, h.application_number) === 'highlight').length;
  const ordered = hits.some((h) => typeof reviews[h.application_number]?.position === 'number');

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
          {/* Fixed layout with sized columns, so the last column is as visible
              as the first. It was auto: the browser gave the wide cells what
              they asked for and cropped Tier to "TIE", which is worse than
              scrolling because nothing tells you a column was lost. The centre
              column never goes below its 640 floor, which is what these widths
              are sized to. */}
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full min-w-[640px] table-fixed text-left text-sm">
              {/* Sized to the centre's 640 floor: 480 fixed leaves 160 for the
                  mark and owner at the narrowest the column ever gets, and all
                  of the slack above that. */}
              <colgroup>
                <col style={{ width: 28 }} />
                <col style={{ width: 60 }} />
                <col />
                <col style={{ width: 96 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 116 }} />
                <col style={{ width: 84 }} />
              </colgroup>
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
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
                {hits.map((h, i) => {
                  const rank = highlightRank(hits, reviews, h.application_number);
                  return (
                  <HitRow
                    key={h.application_number || i}
                    hit={h}
                    tier={tierOf(reviews, h.application_number) ?? DEFAULT_TIER}
                    rank={rank}
                    onReorder={onReorder ? (d) => onReorder(h.application_number, d) : undefined}
                    canMoveUp={rank !== null && rank > 1}
                    canMoveDown={rank !== null && rank < highlightCount}
                    checked={selected.has(h.application_number)}
                    onCheck={(next) => {
                      const s = new Set(selected);
                      if (next) s.add(h.application_number); else s.delete(h.application_number);
                      setSelected(s);
                    }}
                    onOpen={onOpenHit ? () => onOpenHit(h, i) : undefined}
                  />
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Offered only once an order has been chosen: a reset for something
              nobody has changed is a control that does nothing. */}
          {ordered && onClearOrder && (
            <button className="text-xs text-ink-muted underline hover:text-ink" onClick={onClearOrder}>
              Order marks of interest by score
            </button>
          )}

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
