'use client';
import { useEffect, useState, useCallback } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { bvFetch, getActingCompany } from '../../lib/client/acting-company';
import { cacheKey, staleWhileRevalidate } from '../../lib/client/dashboard-cache';
import { panelOpenFromUrl } from '../../lib/deep-links';

type Notif = {
  id: string;
  type: 'renewal_alert' | 'status_change' | 'digest';
  title: string;
  body: string;
  trademark: { id: string; markText: string; registryName: string } | null;
  createdAt: string;
  read: boolean;
};

type BreeAnswer =
  | { kind: 'portfolio'; companyName: string; total: number; registered: number; pending: number; published: number; needsAttention: number }
  | { kind: 'renewals'; items: { markText: string; registry: string; dueDate: string; daysRemaining: number }[] }
  | { kind: 'status'; query: string; groups: { markText: string; rows: { registry: string; status: string; nextDeadline?: { type: string; dueDate: string; daysRemaining: number } }[] }[] }
  | { kind: 'help' };
type BreeReply = BreeAnswer | { kind: 'unsupported' } | { kind: 'clarify'; query: string; options: string[] };

// Single Bree avatar asset (the Slack icon), reused for the toggle, header and
// response rows so she reads consistently with her Slack appearance.
const BreeAvatar = ({ size = 20 }: { size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src="/bree-icon.png" alt="Bree" width={size} height={size} style={{ width: size, height: size, borderRadius: 9999, flexShrink: 0 }} />
);

const TYPE_BADGE: Record<Notif['type'], { label: string; cls: string }> = {
  renewal_alert: { label: 'Renewal', cls: 'bg-amber-100 text-amber-800' },
  status_change: { label: 'Status', cls: 'bg-sky-100 text-sky-800' },
  digest: { label: 'Digest', cls: 'bg-slate-100 text-slate-600' },
};

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function BreeWidget() {
  const { breeOpen, setBreeOpen, data, setSelectedTrademark, showReport, editTarget, sidePanelOpen } = useDashboard();
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [session, setSession] = useState<{ q: string; a: BreeReply }[]>([]);
  const [busy, setBusy] = useState(false);
  // Deep-linked mark, held until the portfolio arrives.
  const [pendingMarkId, setPendingMarkId] = useState<string | null>(null);

  // Threads render from the last response immediately, then refresh.
  const load = useCallback(async () => {
    await staleWhileRevalidate<{ items?: Notif[]; unread?: number }>(
      cacheKey('notifications', getActingCompany()?.id ?? null),
      () => bvFetch('/api/notifications').then((r) => (r.ok ? r.json() : null)),
      (d) => { setNotifs(d.items ?? []); setUnread(d.unread ?? 0); }
    );
  }, []);

  const markRead = useCallback(async (id: string) => {
    setNotifs((ns) => ns.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    await bvFetch(`/api/notifications/${id}/read`, { method: 'POST' });
  }, []);

  const openMark = useCallback(
    (trademarkId: string | null | undefined) => {
      if (!trademarkId || !data) return;
      const mark = data.trademarks.find((t) => t.id === trademarkId);
      if (mark) setSelectedTrademark(mark);
    },
    [data, setSelectedTrademark]
  );

  const openThread = useCallback(
    (n: Notif) => {
      if (!n.read) markRead(n.id);
      openMark(n.trademark?.id);
    },
    [markRead, openMark]
  );

  // Arrival, exactly once.
  //   ?bree=1            → open the panel on the threads view (summary replies)
  //   ?notification=id   → open the panel, mark read, remember which mark to open
  //
  // This used to depend on `openMark`, which is keyed on `data`. When the
  // portfolio landed, `openMark` changed identity, the effect re-ran and fired
  // a second /api/notifications fetch (visible in the HAR as a duplicate), and
  // re-ran the deep-link branch with it. The mark to open is parked in state
  // instead and picked up below once the portfolio exists.
  useEffect(() => {
    load();
    if (panelOpenFromUrl(window.location.search)) setBreeOpen(true);
    const id = new URLSearchParams(window.location.search).get('notification');
    if (!id) return;
    setBreeOpen(true);
    (async () => {
      const res = await bvFetch(`/api/notifications/${id}`);
      if (!res.ok) return; // 404 = not this company's; silently ignore
      const { notification } = await res.json();
      markRead(id);
      const markId = notification?.trademark?.id;
      if (markId) setPendingMarkId(markId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The deep-linked mark can only be opened once the portfolio has loaded.
  useEffect(() => {
    if (!pendingMarkId || !data) return;
    openMark(pendingMarkId);
    setPendingMarkId(null);
  }, [pendingMarkId, data, openMark]);

  const ask = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (!query) return;
    setBusy(true);
    try {
      const res = await bvFetch('/api/bree', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
      const { answer } = await res.json();
      setSession((s) => [...s, { q: query, a: answer }]);
    } catch {
      setSession((s) => [...s, { q: query, a: { kind: 'unsupported' } }]); // never surface a raw error
    } finally {
      setBusy(false);
    }
  }, []);

  function send() {
    const q = input;
    setInput('');
    ask(q);
  }

  const filtered = notifs.filter((n) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return n.trademark?.markText.toLowerCase().includes(q) || n.type.includes(q) || n.title.toLowerCase().includes(q);
  });

  return (
    <>
      {/* Toggle — floating bottom-right (clear of the crowded Topbar); hidden
          while the panel is open (the panel has its own close button).

          The bottom-right corner is reserved, so the pill yields to anything
          that needs it. ReportPanel's action row is justify-content: flex-end,
          which puts Download directly under the pill and made it unclickable.
          The edit form is a modal and the pill would otherwise float above its
          scrim. DetailPanel is deliberately NOT included: its footer is
          left-aligned, so nothing collides, and Bree stays reachable while a
          mark is open, which is the main flow. */}
      {!breeOpen && !showReport && !editTarget && (
        <button
          onClick={() => setBreeOpen(true)}
          // Left of an open panel rather than under it, by the panel's own
          // variable — which is the right one whether the panel is sitting in
          // the rail's column or over it as a slide-over.
          style={{
            position: 'fixed', bottom: 20, zIndex: 9999,
            right: sidePanelOpen ? 'calc(var(--panel-width) + 20px)' : 20,
            transition: 'right 0.12s',
          }}
          className="flex items-center gap-2 rounded-full bg-bree px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-bree-hover"
        >
          <BreeAvatar size={20} />
          Bree
          {unread > 0 && <span className="rounded-full bg-white px-1.5 text-xs font-bold text-bree">{unread}</span>}
        </button>
      )}

      {/* Panel */}
      {breeOpen && (
        <div
          style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 360, zIndex: 9998 }}
          className="flex flex-col border-l border-slate-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <span className="flex items-center gap-2">
              <BreeAvatar size={24} />
              <span className="font-semibold text-bree">Bree</span>
            </span>
            <button onClick={() => setBreeOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
          </div>

          <div className="border-b border-slate-100 p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by mark or type"
              className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No notifications.</p>
            ) : (
              <ul>
                {filtered.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openThread(n)}
                      className={`flex w-full items-start gap-2 border-b border-slate-50 px-4 py-2.5 text-left hover:bg-slate-50 ${n.read ? '' : 'bg-slate-50/60'}`}
                    >
                      <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_BADGE[n.type].cls}`}>{TYPE_BADGE[n.type].label}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-800">{n.trademark?.markText ?? n.title}</span>
                        <span className="block truncate text-xs text-slate-500">{n.body}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Session Q&A (ephemeral) */}
          {session.length > 0 && (
            <div className="max-h-56 overflow-y-auto border-t border-slate-200 bg-slate-50 p-3 text-sm">
              {session.map((x, i) => (
                <div key={i} className="mb-3 last:mb-0">
                  <div className="text-xs text-slate-500">{x.q}</div>
                  <div className="mt-1 flex gap-2">
                    <BreeAvatar size={20} />
                    <div className="text-slate-800">{renderAnswer(x.a, ask)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-200 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                placeholder="Ask Bree: portfolio, renewals, status ACME"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              <button onClick={send} disabled={busy} className="rounded-lg bg-bree px-3 py-1.5 text-sm font-medium text-white hover:bg-bree-hover disabled:opacity-50">
                {busy ? '…' : 'Send'}
              </button>
            </div>
            <FeedbackBox />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * "Send feedback" in the panel footer, opening a plain text box.
 *
 * The Slack message the API posts is the whole record, so this stores nothing
 * and asks for nothing beyond the text. Delivery is reported as the route
 * reports it: when the company has not connected Slack there is nowhere for the
 * feedback to go, and saying so is better than a thank-you for a message that
 * was never sent.
 */
function FeedbackBox() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<'sent' | 'undelivered' | 'cross_tenant' | 'error' | null>(null);
  // The server's reason for a refusal. Without this every non-2xx collapsed
  // into "try again", which hid four distinct causes behind one dead end —
  // including a stale acting company in localStorage pointing at a deleted
  // row, which 404s every write while reads keep working.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setResult(null);
    setErrorDetail(null);
    try {
      const res = await bvFetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body }),
      });
      if (!res.ok) {
        const detail = await res.json().then((d) => d?.error).catch(() => null);
        setErrorDetail(typeof detail === 'string' && detail ? detail : `Request failed (${res.status})`);
        setResult('error');
        return;
      }
      const { delivered, reason } = await res.json();
      setResult(delivered ? 'sent' : reason === 'cross_tenant' ? 'cross_tenant' : 'undelivered');
      if (delivered) {
        setText('');
        setOpen(false);
      }
    } catch {
      setResult('error');
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-2 text-right">
        <button
          onClick={() => { setOpen(true); setResult(null); }}
          // Quiet, but actually visible. At slate-400 with a hover-only
          // underline this read as decoration and was missed entirely by the
          // person who asked for it, sitting as it does under a much louder
          // indigo Send button.
          className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700"
        >
          Send feedback
        </button>
        {/* Confirms receipt, not transport. The sender cares that it reached
            us; "your Slack channel" is also wrong for anyone who is not the
            workspace owner. */}
        {result === 'sent' && <p className="mt-1 text-xs text-slate-500">Thanks, we&rsquo;ve received your feedback.</p>}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
        maxLength={2000}
        // Enter sends, Shift+Enter starts a new line. Matches the Bree message
        // input above, which sends on Enter, and the usual convention for a
        // multi-line compose box. preventDefault stops the newline being
        // inserted before the box is cleared.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="What is working, what is not? Enter to send, Shift and Enter for a new line"
        className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="mt-1.5 flex items-center justify-end gap-2">
        <button onClick={() => { setOpen(false); setResult(null); }} className="text-xs text-slate-400 hover:text-slate-700">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={sending || !text.trim()}
          className="rounded-lg bg-bree px-3 py-1.5 text-xs font-medium text-white hover:bg-bree-hover disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
      {result === 'undelivered' && (
        <p className="mt-1 text-xs text-amber-700">Slack is not connected for your company, so this was not sent.</p>
      )}
      {result === 'cross_tenant' && (
        <p className="mt-1 text-xs text-amber-700">You are acting as another company. Feedback is not sent from a switched context.</p>
      )}
      {result === 'error' && (
        <p className="mt-1 text-xs text-amber-700">
          That did not send{errorDetail ? `: ${errorDetail}` : ''}.
        </p>
      )}
    </div>
  );
}

function renderAnswer(a: BreeReply, onAsk: (q: string) => void) {
  switch (a?.kind) {
    case 'portfolio':
      return `${a.companyName}: ${a.total} marks · ${a.registered} registered · ${a.pending + a.published} in prosecution · ${a.needsAttention} need attention`;
    case 'renewals':
      return a.items.length ? (
        <ul className="list-disc pl-4">
          {a.items.map((i, k) => (
            <li key={k}>{i.markText} ({i.registry}) — {i.daysRemaining}d · {i.dueDate}</li>
          ))}
        </ul>
      ) : (
        'No upcoming renewals.'
      );
    case 'status':
      return a.groups.length
        ? a.groups.map((g, k) => (
            <div key={k}>
              <b>{g.markText}</b>: {g.rows.map((r) => `${r.registry} ${r.status}`).join(', ')}
            </div>
          ))
        : 'No matching mark.';
    case 'clarify':
      return (
        <div>
          <div>Which mark did you mean?</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {a.options.map((opt, k) => (
              <button key={k} onClick={() => onAsk(`status ${opt}`)} className="rounded border border-bree px-2 py-0.5 text-xs text-bree hover:bg-bree hover:text-white">
                {opt}
              </button>
            ))}
          </div>
        </div>
      );
    case 'unsupported':
      return 'Bree can answer three things: your portfolio summary, upcoming renewals, or a mark’s status.';
    case 'help':
    default:
      return 'Try: portfolio · renewals · status [mark]';
  }
}
