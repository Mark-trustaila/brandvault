'use client';

/**
 * Past registry searches (docs/clearance-workflow.md §6).
 *
 * The same table appears under the query box and as the Clearances nav page,
 * so the two routes show the same thing rather than two views that drift.
 *
 * Clicking a row reopens the saved record with its tiers, notes and order as
 * saved. It does not re-run the search: the register moves, and a row that
 * quietly returned different results from the ones someone reviewed would make
 * the review meaningless. Re-running is a deliberate action inside the record.
 */
import { useMemo, useState } from 'react';
import { matchesHistory, type HistoryRow } from '../../lib/clearance-review';
import { registryLabel } from '../../lib/smart-search-registries';

const REPORT_LABEL: Record<HistoryRow['reportState'], string> = {
  none: '—',
  draft: 'Draft',
  issued: 'Issued',
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ClearancesTable({ rows, onOpen, currentId }: {
  rows: HistoryRow[];
  onOpen: (id: string) => void;
  currentId?: string | null;
}) {
  const [q, setQ] = useState('');
  // Filtered here as well as on the server: typing should not wait on a round
  // trip, and the server filter is what makes a deep link with ?q= work.
  const shown = useMemo(() => rows.filter((r) => matchesHistory(r, q)), [rows, q]);

  if (rows.length === 0) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        No registry searches yet. Run one above and it is saved here.
      </div>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Registry searches</h2>
        <input
          className="ml-auto w-64 rounded-md border border-line p-1.5 text-sm"
          placeholder="Filter by term, class, register or person"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Term</th>
              <th className="px-3 py-2 font-medium">Register</th>
              <th className="px-3 py-2 font-medium">Classes</th>
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">Hits</th>
              <th className="px-3 py-2 font-medium">Report</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${r.id === currentId ? 'bg-slate-50' : ''}`}
              >
                <td className="px-3 py-2">
                  <span className="font-medium text-slate-900">{r.term}</span>
                  {/* Named rather than implied: a search run from a mark is a
                      different act from one someone typed, and the report says so. */}
                  {r.markRef && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">from {r.markRef}</span>
                  )}
                  {r.status === 'failed' && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">did not run</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-700">{registryLabel(r.registry)}</td>
                <td className="px-3 py-2 text-slate-700">{r.classes.length ? r.classes.join(', ') : 'all'}</td>
                <td className="px-3 py-2 text-slate-700">
                  {formatWhen(r.runAt)}
                  <div className="text-xs text-slate-500">{r.runByName ?? 'unknown'}</div>
                </td>
                {/* A failed search found nothing because it never looked; a zero
                    there would read as a clear register. */}
                <td className="px-3 py-2 tabular-nums text-slate-700">{r.status === 'failed' ? '—' : r.hitCount}</td>
                <td className="px-3 py-2 text-slate-500">{REPORT_LABEL[r.reportState]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && (
        <p className="text-xs text-slate-500">No search matches “{q}”. {rows.length} in total.</p>
      )}
    </section>
  );
}
