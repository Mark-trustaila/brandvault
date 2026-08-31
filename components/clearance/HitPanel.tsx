'use client';

/**
 * One clearance hit, opened in the right-hand panel (docs/clearance-workflow.md §5).
 *
 * Same pattern as the portfolio's DetailPanel — right-hand slide-over, backdrop,
 * previous and next in the header — but its own component rather than an
 * extension of that one. DetailPanel is CSS Modules and bound to `Trademark`
 * and DashboardContext; a clearance hit is a different entity from a different
 * source and shares no fields, so extending it would have meant two data
 * shapes in one component. New component, so Tailwind, per the CSS rule.
 *
 * Previous and next walk the list without returning to it, because reviewing
 * twenty hits means twenty decisions and closing the panel between each one
 * loses the reader's place.
 *
 * The specification comes from the registry facade, which implements GB only.
 * A WO hit shows what the search returned plus the register link and says the
 * specification is not available for that register. Never a blank section: an
 * empty specification reads as a mark with no goods, which is not a thing.
 */
import { useCallback, useEffect, useState } from 'react';
import { hitMarkText, hitClassesLabel, type SmartSearchHit } from '../../lib/smart-search-hit';
import { registerDeepLink, registryLabel } from '../../lib/smart-search-registries';
import { TIERS, TIER_LABEL, isExactMatch, type HitReview, type Tier } from '../../lib/clearance-review';
import { bvFetch } from '../../lib/client/acting-company';

type Lookup = {
  available: boolean;
  found?: boolean;
  reason?: string;
  mark?: any;
  ownerMarks?: Array<{ ownerString: string; markCount: number; matchedVia: string[] }>;
  error?: string;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Dates the facade returns as a path/value list; pick the ones worth showing. */
function pickDates(mark: any): Array<{ label: string; value: string }> {
  const dates: Array<{ path: string; value: string }> = mark?.dates ?? [];
  const wanted: Array<[RegExp, string]> = [
    [/ApplicationDate/i, 'Filed'],
    [/RegistrationDate/i, 'Registered'],
    [/ExpiryDate|RenewalDate/i, 'Renewal due'],
    [/PublicationDate/i, 'Published'],
  ];
  const out: Array<{ label: string; value: string }> = [];
  for (const [re, label] of wanted) {
    const hit = dates.find((d) => re.test(d.path));
    if (hit) out.push({ label, value: formatDate(hit.value) });
  }
  return out;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-100 px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

export default function HitPanel({ hit, registry, index, total, review, onClose, onPrev, onNext, onReview }: {
  hit: SmartSearchHit;
  registry: string;
  index: number;
  total: number;
  review?: HitReview;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onReview?: (patch: { tier?: Tier; note?: string }) => void;
}) {
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [note, setNote] = useState(review?.note ?? '');
  const appNo = hit.application_number;

  // Reset per hit: walking to the next one must not carry the previous note
  // into a different mark's textarea.
  useEffect(() => { setNote(review?.note ?? ''); }, [appNo, review?.note]);

  useEffect(() => {
    let live = true;
    setLookup(null);
    const params = new URLSearchParams({ registry, applicationNumber: appNo });
    if (hit.owner) params.set('owner', hit.owner);
    bvFetch(`/api/registry/mark?${params}`)
      .then((r) => r.json())
      .then((j) => { if (live) setLookup(j); })
      .catch(() => { if (live) setLookup({ available: false, reason: 'The register could not be reached.' }); });
    return () => { live = false; };
  }, [appNo, registry, hit.owner]);

  // Arrow keys walk the list, as they do in a mail client. Ignored while
  // someone is typing a note.
  const onKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (e.key === 'ArrowLeft' && onPrev) onPrev();
    if (e.key === 'ArrowRight' && onNext) onNext();
    if (e.key === 'Escape') onClose();
  }, [onPrev, onNext, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const link = registerDeepLink(registry, appNo);
  const tier: Tier = (review?.tier as Tier) ?? 'appendix';
  const spec: Array<{ class_number: string; description: string }> = lookup?.mark?.goods_services ?? [];

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-slate-900">
              {hitMarkText(hit) || '[no verbal element]'}
              {isExactMatch(hit) && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800">identical</span>}
            </h2>
            <p className="truncate text-xs text-slate-500">{registryLabel(registry)} · {appNo} · score {hit.score}</p>
          </div>
          <span className="whitespace-nowrap text-xs text-slate-400">{index + 1} of {total}</span>
          <button className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40" onClick={onPrev} disabled={!onPrev} aria-label="Previous hit">←</button>
          <button className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-40" onClick={onNext} disabled={!onNext} aria-label="Next hit">→</button>
          <button className="rounded px-2 py-1 text-lg text-slate-400 hover:text-slate-700" onClick={onClose} aria-label="Close">×</button>
        </header>

        <Section title="The mark">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Owner</dt><dd className="text-slate-800">{hit.owner ?? 'not recorded'}</dd>
            <dt className="text-slate-500">Status</dt><dd className="text-slate-800">{hit.status || '—'}</dd>
            <dt className="text-slate-500">Application</dt><dd className="tabular-nums text-slate-800">{appNo}</dd>
            <dt className="text-slate-500">Filed</dt><dd className="text-slate-800">{formatDate(hit.application_date)}</dd>
            <dt className="text-slate-500">Classes</dt><dd className="text-slate-800">{hitClassesLabel(hit) || '—'}</dd>
            {pickDates(lookup?.mark).map((d) => (
              <span key={d.label} className="contents"><dt className="text-slate-500">{d.label}</dt><dd className="text-slate-800">{d.value}</dd></span>
            ))}
          </dl>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-slate-600 underline">
              Open on the register ↗
            </a>
          )}
        </Section>

        <Section title="Goods and services">
          {lookup === null ? (
            <p className="text-sm text-slate-500">Reading the register…</p>
          ) : !lookup.available ? (
            <p className="text-sm text-amber-800">{lookup.reason ?? 'Not available for this register.'}</p>
          ) : lookup.error ? (
            <p className="text-sm text-amber-800">The register could not be read: {lookup.error}</p>
          ) : lookup.found === false ? (
            <p className="text-sm text-amber-800">
              No record for {appNo} in the corpus. While UK009 coverage is partial that is not proof the mark does not
              exist — check the register directly before relying on it.
            </p>
          ) : spec.length === 0 ? (
            <p className="text-sm text-slate-500">The record carries no specification text.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {spec.map((g, i) => (
                <li key={i}>
                  <div className="font-medium text-slate-800">Class {g.class_number}</div>
                  <div className="text-slate-600">{g.description}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {(lookup?.ownerMarks?.length ?? 0) > 0 && (
          <Section title="What else this owner holds">
            <ul className="space-y-1 text-sm">
              {lookup!.ownerMarks!.slice(0, 8).map((o) => (
                <li key={o.ownerString} className="flex justify-between gap-3">
                  <span className="text-slate-700">{o.ownerString}</span>
                  <span className="whitespace-nowrap text-slate-500">{o.markCount} marks</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {onReview && (
          <Section title="Your review">
            <div className="flex flex-wrap gap-2">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => onReview({ tier: t })}
                  className={`rounded border px-2.5 py-1 text-sm ${
                    tier === t ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {TIER_LABEL[t]}
                </button>
              ))}
            </div>
            <textarea
              className="mt-2 w-full rounded border border-slate-300 p-2 text-sm"
              rows={3}
              placeholder="Why this matters, or why it does not…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => { if (note !== (review?.note ?? '')) onReview({ note }); }}
            />
            <p className="text-xs text-slate-400">Saved when you click away.</p>
          </Section>
        )}
      </aside>
    </div>
  );
}
