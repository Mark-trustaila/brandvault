'use client';
import AppShell from '../../../components/layout/AppShell';
import { useEffect, useState } from 'react';
import { bvFetch } from '../../../lib/client/acting-company';

type Prefs = {
  slackConnected: boolean;
  slackTeamName: string | null;
  slackEnabled: boolean;
  slackChannelId: string;
  emailEnabled: boolean;
  emailAvailable: boolean;
  thresholdDays: number[];
  installUrl: string;
};

const BANNERS: Record<string, { text: string; tone: 'ok' | 'err' }> = {
  connected: { text: 'Slack connected — Bree is ready. Set a channel below and save.', tone: 'ok' },
  denied: { text: 'Slack connection was cancelled.', tone: 'err' },
  badstate: { text: 'Slack connection failed a security check. Please try again.', tone: 'err' },
  error: { text: 'Slack connection failed. Please try again.', tone: 'err' },
};

export default function AlertSettingsPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [thresholds, setThresholds] = useState('180, 90, 30');
  const [channel, setChannel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [banner, setBanner] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get('slack');
    if (b && BANNERS[b]) setBanner(BANNERS[b]);
    bvFetch('/api/alerts/preferences')
      .then((r) => r.json())
      .then((p: Prefs) => {
        setPrefs(p);
        setThresholds(p.thresholdDays.join(', '));
        setChannel(p.slackChannelId);
      })
      .catch(() => setPrefs(null));
  }, []);

  async function save() {
    if (!prefs) return;
    setSaving(true);
    setSaved(false);
    const thresholdDays = thresholds
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    const res = await bvFetch('/api/alerts/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slackEnabled: prefs.slackEnabled,
        emailEnabled: prefs.emailEnabled,
        slackChannelId: channel,
        thresholdDays,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  if (!prefs) {
    return <div className="mx-auto max-w-2xl px-6 py-16 text-slate-500">Loading alert settings…</div>;
  }

  return (
    <AppShell>
      <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Alerts</h1>
      <p className="mt-1 text-sm text-slate-500">
        Bree posts renewal reminders, status changes and a weekly digest to your Slack.
      </p>

      {banner && (
        <div
          className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
            banner.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {banner.text}
        </div>
      )}

      {/* Slack connection */}
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-slate-900">Slack</h2>
            {prefs.slackConnected ? (
              <p className="mt-0.5 text-sm text-emerald-600">
                Connected{prefs.slackTeamName ? ` to ${prefs.slackTeamName}` : ''}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-slate-500">Not connected yet.</p>
            )}
          </div>
          <a
            href={prefs.installUrl}
            className="rounded-lg bg-[#4A154B] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {prefs.slackConnected ? 'Reconnect' : 'Connect Slack'}
          </a>
        </div>

        {prefs.slackConnected && (
          <div className="mt-5 space-y-4 border-t border-slate-100 pt-5">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={prefs.slackEnabled}
                onChange={(e) => setPrefs({ ...prefs, slackEnabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700">Send alerts to Slack</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-slate-700">Channel ID</label>
              <input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="C0123456789"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-slate-400">
                In Slack, open the channel → its name → copy the Channel ID at the bottom. A channel picker is coming soon.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Renewal thresholds */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">Renewal reminders</h2>
        <p className="mt-0.5 text-sm text-slate-500">Days before a deadline to send a reminder (up to three).</p>
        <input
          value={thresholds}
          onChange={(e) => setThresholds(e.target.value)}
          placeholder="180, 90, 30"
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </section>

      {/* Email (not yet available) */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-slate-500">Email</h2>
            <p className="mt-0.5 text-sm text-slate-400">A secondary alert channel — coming soon.</p>
          </div>
          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-500">Coming soon</span>
        </div>
      </section>

      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
      </div>
    </AppShell>
  );
}
