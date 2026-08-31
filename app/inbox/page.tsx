'use client';
import { useEffect, useState, useCallback } from 'react';
import AppShell from '../../components/layout/AppShell';
import { bvFetch } from '../../lib/client/acting-company';

type Classification = {
  registry?: string;
  communicationType?: string;
  confidence?: string;
  referenceNumbers?: string[];
  deadlinesMentioned?: { date: string; description: string }[];
  summary?: string;
} | null;

type Email = {
  id: string;
  receivedAt: string;
  fromAddress: string;
  subject: string;
  status: string;
  classification: Classification;
  reviewClassification: unknown;
  matchedTrademark: { id: string; markText: string; registryName: string; status: string } | null;
  attachments: { filename: string; mimeType: string }[];
  reviewedAt: string | null;
};

const TABS: { key: string; label: string }[] = [
  { key: 'needs_review', label: 'Needs review' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'processed', label: 'Reviewed' },
  { key: 'dismissed', label: 'Dismissed' },
];

const REGISTRIES = ['UKIPO', 'EUIPO', 'WIPO', 'other', 'unknown'];
const TYPES = [
  'registration_certificate', 'renewal_reminder', 'renewal_confirmation', 'examination_report',
  'opposition_notice', 'opposition_procedural', 'watch_notice', 'cancellation_notice',
  'euipo_login_notification', 'ambiguous', 'other',
];

const STATUS_STYLE: Record<string, string> = {
  needs_review: 'bg-amber-100 text-amber-800',
  unmatched: 'bg-violet-100 text-violet-800',
  processed: 'bg-emerald-100 text-emerald-800',
  dismissed: 'bg-slate-100 text-slate-500',
  pending: 'bg-slate-100 text-slate-600',
};

export default function InboxPage() {
  const [tab, setTab] = useState('needs_review');
  const [emails, setEmails] = useState<Email[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    const res = await bvFetch(`/api/email/inbox?status=${status}`);
    const data = await res.json();
    setEmails(data.emails ?? []);
    setCounts(data.counts ?? {});
    setLoading(false);
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab, load]);

  async function act(id: string, action: string, correction?: unknown) {
    const res = await bvFetch(`/api/email/inbox/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, correction }),
    });
    if (res.ok) {
      setEditing(null);
      load(tab);
    } else {
      const e = await res.json().catch(() => ({}));
      alert(e.error ?? 'Action failed');
    }
  }

  return (
    <AppShell>
      <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Inbox</h1>
      <p className="mt-1 text-sm text-slate-500">Registry correspondence Bree classified. Confirm, correct, or dismiss.</p>

      <div className="mt-6 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
            {counts[t.key] ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400">Loading…</div>
      ) : emails.length === 0 ? (
        <div className="py-16 text-center text-slate-400">Nothing in this queue.</div>
      ) : (
        <ul className="mt-6 space-y-4">
          {emails.map((e) => (
            <li key={e.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{e.subject || '(no subject)'}</div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {e.fromAddress} · {new Date(e.receivedAt).toLocaleDateString()}
                    {e.attachments.length ? ` · 📎 ${e.attachments.length}` : ''}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[e.status] ?? 'bg-slate-100'}`}>
                  {e.status.replace('_', ' ')}
                </span>
              </div>

              {e.classification && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">{e.classification.communicationType}</span>
                    <span className="text-xs text-slate-500">{e.classification.registry}</span>
                    <span className="text-xs text-slate-400">· {e.classification.confidence} confidence</span>
                  </div>
                  {e.classification.summary && <p className="mt-2 text-slate-600">{e.classification.summary}</p>}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    {e.classification.referenceNumbers?.length ? <span>Refs: {e.classification.referenceNumbers.join(', ')}</span> : null}
                    {e.classification.deadlinesMentioned?.length ? <span>Deadline: {e.classification.deadlinesMentioned[0].date}</span> : null}
                  </div>
                  <div className="mt-2 text-xs">
                    {e.matchedTrademark ? (
                      <span className="text-emerald-600">Matched: {e.matchedTrademark.markText} ({e.matchedTrademark.registryName})</span>
                    ) : (
                      <span className="text-violet-600">Not matched to a mark in your portfolio</span>
                    )}
                  </div>
                </div>
              )}

              {editing === e.id ? (
                <CorrectForm
                  onCancel={() => setEditing(null)}
                  onSubmit={(correction) => act(e.id, 'correct', correction)}
                  initial={e.classification}
                />
              ) : (
                e.status !== 'dismissed' &&
                e.status !== 'processed' && (
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => act(e.id, 'confirm')} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Confirm</button>
                    <button onClick={() => setEditing(e.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Correct</button>
                    <button onClick={() => act(e.id, 'dismiss')} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100">Dismiss</button>
                  </div>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      </div>
    </AppShell>
  );
}

function CorrectForm({ initial, onSubmit, onCancel }: { initial: Classification; onSubmit: (c: unknown) => void; onCancel: () => void }) {
  const [registry, setRegistry] = useState(initial?.registry ?? 'UKIPO');
  const [communicationType, setCommunicationType] = useState(initial?.communicationType ?? 'other');
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Registry</span>
          <select value={registry} onChange={(e) => setRegistry(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {REGISTRIES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-500">Type</span>
          <select value={communicationType} onChange={(e) => setCommunicationType(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSubmit({ registry, communicationType })} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save correction</button>
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}
