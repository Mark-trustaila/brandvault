'use client';

/**
 * Smart Search results — the whole outcome of a search, in one component.
 *
 * New component, so Tailwind only (never mixed with the CSS Modules the older
 * panels use).
 *
 * Four outcomes, each rendered as itself:
 *
 *   running    — the search is with the register; say so and keep polling.
 *   completed  — hits, or an honest "nothing found" with the same currency
 *                banner attached. A clean result is a finding.
 *   failed     — contract §3.3. The register was NOT searched. Rendered as a
 *                first-class state carrying its reason, never as a toast over
 *                an empty table: an empty table says "nothing like your mark is
 *                registered", which is the opposite of what a failure means,
 *                and is the answer a lawyer would act on. The searcher worker
 *                has a documented history of failing; the UI tells the truth
 *                about it.
 *   error      — the facade could not be reached. Also not an empty list.
 *
 * currencyDate and coverage ride on every settled outcome, as the registry
 * views do — sourced from the response, never assumed here.
 */
import type { Coverage, SmartSearchResult } from '../../lib/smart-search';
import { hitMarkText, hitClassesLabel, truncationNotice, type SmartSearchHit } from '../../lib/smart-search-hit';
import { registryLabel, registryInProse } from '../../lib/smart-search-registries';

export type PanelState = {
  result: SmartSearchResult | null;
  polling: boolean;
  error: string | null;
};

const VERDICT_STYLE: Record<string, string> = {
  'very high': 'bg-rose-100 text-rose-800',
  high: 'bg-amber-100 text-amber-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-slate-100 text-slate-600',
};

function Verdict({ similarity }: { similarity: string | null }) {
  const label = (similarity ?? '').trim();
  const style = VERDICT_STYLE[label.toLowerCase()] ?? 'bg-slate-100 text-slate-600';
  // An unrecorded verdict is shown as unrecorded, not silently promoted to Low.
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${style}`}>
      {label || 'not rated'}
    </span>
  );
}

/** ISO date to a readable one. A missing date stays visibly missing. */
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

function HitRow({ hit }: { hit: SmartSearchHit }) {
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="py-2 pr-3"><Verdict similarity={hit.similarity} /></td>
      <td className="py-2 pr-3 tabular-nums text-slate-600">{hit.score}</td>
      <td className="py-2 pr-3">
        <div className="font-medium text-slate-900">{hitMarkText(hit) || '—'}</div>
        <div className="text-xs text-slate-500">{hit.owner ?? 'owner not recorded'}</div>
      </td>
      <td className="py-2 pr-3">
        <div className="text-slate-700">{hitClassesLabel(hit) || '—'}</div>
        {hit.class_match ? (
          <span className="mt-0.5 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">class overlap</span>
        ) : (
          <span className="mt-0.5 inline-block text-xs text-slate-400">no class overlap</span>
        )}
      </td>
      <td className="py-2 pr-3 text-slate-700">{hit.status || '—'}</td>
      <td className="py-2 pr-3">
        <div className="tabular-nums text-slate-700">{hit.application_number || '—'}</div>
        <div className="text-xs text-slate-500">{formatDate(hit.application_date)}</div>
      </td>
    </tr>
  );
}

/**
 * The facade's order is the order. Not re-sorted here, and specifically not by
 * score descending, which is what this did until a live search proved score is
 * a distance rather than a similarity: ASOS itself scores 19 against its own
 * term while EZEEZ scores 50. Sorting descending led a clearance search for
 * ASOS with EZEEZ, S8 and OSY and buried the exact match two hundred rows down.
 *
 * §2.3 calls score "the numeric basis" for the verdict and never states its
 * direction, so re-ranking on it was a guess. The engine already returns hits in
 * its own order; showing that order asserts nothing we cannot support.
 */

const count = (n: number) => n.toLocaleString('en-GB');

/**
 * The register held more than the facade returned.
 *
 * A warning, before the list, not a footnote after it. A truncated list that
 * reads as a complete search of the register is a false clear, and a false
 * clear is the one wrong answer in clearance nobody catches: the lawyer acts
 * on an absence that was never established. The registry facade refuses a
 * too-large import outright; Smart Search truncates instead, because a
 * clearance search loses less from a missing tail than from no answer — but
 * only if the tail is declared.
 */
function TruncationNotice({ result }: { result: SmartSearchResult }) {
  const notice = truncationNotice(result);
  if (!notice) return null;
  return (
    <section className="rounded border border-amber-300 bg-amber-50 p-3">
      <h2 className="text-sm font-semibold text-amber-900">
        This is not the whole of {registryInProse(result.registry)}
      </h2>
      {notice.kind === 'known' ? (
        <p className="mt-1 text-sm text-amber-800">
          Showing {count(notice.shown)} of {count(notice.total)} matching marks
          {notice.cap !== null && ` — the facade returns at most ${count(notice.cap)} per search`}.
          The rest were not returned and have not been looked at.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-amber-800">
            Showing {count(notice.shown)} — {registryInProse(result.registry)} holds more matches than the search
            can return; this list is incomplete.
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {notice.upstreamCap !== null
              ? `The register's own search returns at most ${count(notice.upstreamCap)} results and does not say how many it found`
              : `${registryInProse(result.registry).replace(/^the/, 'The')} does not say how many matches it found`}
            {notice.atLeast !== null && `, so the true number is unknown — at least ${count(notice.atLeast)} exist`}.
          </p>
        </>
      )}
      <p className="mt-1 text-xs text-amber-800">
        Narrow the term or the classes and run it again before treating {result.term} as clear.
      </p>
    </section>
  );
}

function Summary({ result }: { result: SmartSearchResult }) {
  const hits = result.results ?? [];
  const veryHigh = hits.filter((h) => (h.similarity ?? '').toLowerCase() === 'very high').length;
  const overlap = hits.filter((h) => h.class_match).length;
  // When the list is capped the headline says so too, so the two lines cannot
  // disagree about how much of the register was searched. With an unknown total
  // it says "the register holds more" rather than naming a number: result_count
  // is not a total, and rendering it as one is the false clear this exists to
  // prevent.
  const notice = truncationNotice(result);
  const lead = !notice
    ? `${count(hits.length)} ${hits.length === 1 ? 'hit' : 'hits'}`
    : notice.kind === 'known'
      ? `Showing ${count(notice.shown)} of ${count(notice.total)} hits`
      : `Showing ${count(notice.shown)} hits — the register holds more`;
  return (
    <p className="text-sm text-slate-700">
      {lead} for <strong>{result.term}</strong> in {registryLabel(result.registry)}
      {result.classes.length ? `, class ${result.classes.join(', ')}` : ', all classes'}
      {hits.length > 0 && ` · ${veryHigh} rated very high · ${overlap} with class overlap`}
    </p>
  );
}

export default function ResultsPanel({ result, polling, error }: PanelState) {
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

  // §3.3. A failure is not an empty result and must never read as one.
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

  const hits = result.results ?? [];

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <Summary result={result} />
        <Banners currencyDate={result.currencyDate} coverage={result.coverage} />
      </div>

      <TruncationNotice result={result} />

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
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Similarity</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Mark and owner</th>
                <th className="px-3 py-2 font-medium">Classes</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Application</th>
              </tr>
            </thead>
            <tbody className="[&_td:first-child]:pl-3 [&_td:last-child]:pr-3">
              {hits.map((h) => <HitRow key={h.id || h.application_number} hit={h} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
