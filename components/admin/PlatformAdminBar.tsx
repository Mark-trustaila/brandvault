'use client';
import { useEffect, useState } from 'react';
import { bvFetch, getActingCompany, setActingCompany } from '../../lib/client/acting-company';
import { cacheKey, staleWhileRevalidate } from '../../lib/client/dashboard-cache';

type Me = {
  isPlatformAdmin: boolean;
  user: { name: string } | null;
  company: { id: string; name: string } | null;
};
type Company = { id: string; name: string; trademarkCount: number; linked: boolean };
type ClerkOrg = { id: string; name: string; linkedTo: string | null };
type AuditEntry = {
  id: string;
  action: string;
  actor: string;
  reason?: string;
  isPlatformAdmin: boolean;
  date: string;
};

/**
 * Platform-admin surface: a cross-tenant company switcher + an activity-log
 * flyout backed by /api/audit. Selecting a company other than the admin's own
 * org stores it as the acting company (bvFetch then sends x-bv-company-id on
 * reads + writes) and reloads so the dashboard shows that company's data.
 * Renders nothing for non-admins. New component: Tailwind only.
 */
export function PlatformAdminBar() {
  const [me, setMe] = useState<Me | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [orgs, setOrgs] = useState<ClerkOrg[] | null>(null);
  // Always starts collapsed, on every arrival including a Slack deep link.
  // It expands only on click. Within a session the state survives client-side
  // navigation because the component is not remounted; a fresh page load
  // deliberately starts collapsed again.
  const [collapsed, setCollapsed] = useState(true);

  const toggleCollapsed = () => setCollapsed((c) => !c);

  useEffect(() => {
    setActingId(getActingCompany()?.id ?? null);
    // Cached so the bar does not pop in on every visit while /api/me
    // round-trips. Not company-scoped: this is who *you* are, not tenant data.
    staleWhileRevalidate<Me>(
      cacheKey('me', null),
      () => fetch('/api/me').then((r) => (r.ok ? r.json() : null)),
      setMe
    );
  }, []);

  useEffect(() => {
    if (!me?.isPlatformAdmin) return;
    fetch('/api/admin/companies')
      .then((r) => (r.ok ? r.json() : { companies: [] }))
      .then((d) => setCompanies(d.companies ?? []))
      .catch(() => {});
  }, [me?.isPlatformAdmin]);

  useEffect(() => {
    if (!open) return;
    bvFetch('/api/audit')
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => {});
  }, [open]);

  if (!me?.isPlatformAdmin) return null;

  const homeId = me.company?.id ?? '';
  const currentId = actingId ?? homeId;
  const crossTenant = Boolean(actingId && actingId !== homeId);
  const current = companies.find((c) => c.id === currentId);

  const openLink = () => {
    fetch('/api/admin/clerk-orgs')
      .then((r) => (r.ok ? r.json() : { orgs: [] }))
      .then((d) => setOrgs(d.orgs ?? []))
      .catch(() => setOrgs([]));
  };
  const doLink = async (orgId: string) => {
    if (!current || !orgId) return;
    const r = await fetch(`/api/admin/companies/${current.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clerkOrgId: orgId }),
    });
    if (r.ok) window.location.reload();
    else window.alert((await r.json().catch(() => ({}))).error || 'Link failed');
  };

  const onSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id || id === homeId) {
      setActingCompany(null);
    } else {
      const c = companies.find((x) => x.id === id);
      if (c) setActingCompany({ id: c.id, name: c.name });
    }
    window.location.reload();
  };

  const createCompany = async () => {
    const name = window.prompt('New customer company name:')?.trim();
    if (!name) return;
    const r = await fetch('/api/admin/companies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      const c = await r.json();
      setActingCompany({ id: c.id, name: c.name }); // act on the new company
      window.location.reload();
    } else {
      window.alert('Could not create company');
    }
  };

  return (
    <div className="fixed bottom-4 left-[calc(var(--sidebar-width)+1rem)] z-50 font-sans">
      <div className="flex flex-wrap items-center gap-1 rounded-full border border-white/[0.06] bg-admin px-1.5 py-1 text-slate-200 shadow-lg">
        {/* Badge doubles as the collapse toggle: click to fold the bar to the badge alone. */}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand admin controls' : 'Collapse to badge'}
          className="rounded-full bg-[#1B2A4E] px-2.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
        >
          Platform admin
        </button>
        {!collapsed && (
          <>
            <div className="relative">
              <select
                value={currentId}
                onChange={onSelect}
                title="Act on a company"
                className="max-w-[190px] cursor-pointer appearance-none rounded-full bg-transparent py-1 pl-2 pr-5 text-xs text-slate-200 transition-colors hover:bg-white/[0.08] focus:outline-none"
              >
                {companies.length === 0 && <option value={homeId}>{me.company?.name ?? '—'}</option>}
                {companies.map((c) => (
                  <option key={c.id} value={c.id} className="text-ink">
                    {c.id === homeId ? `${c.name} (my org)` : c.name} · {c.trademarkCount}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">▾</span>
            </div>
            <button
              onClick={createCompany}
              className="rounded-full px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              + Company
            </button>
            {/* Import is how a concierge-onboarded customer actually gets a
                portfolio; bulk entry is the manual fallback. The bar linked only
                to the fallback, so the main path was a URL you had to remember. */}
            <a
              href="/admin/import"
              className="rounded-full px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              Import portfolio
            </a>
            <a
              href="/admin/bulk"
              className="rounded-full px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              Enter marks
            </a>
            <button
              onClick={() => setOpen((o) => !o)}
              className="rounded-full px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-white/[0.08]"
            >
              {open ? 'Hide activity' : 'Activity'}
            </button>
          </>
        )}
      </div>

      {!collapsed && crossTenant && (
        <div className="mt-1.5 inline-block rounded-full border border-white/[0.06] bg-admin px-2.5 py-0.5 text-[11px] text-slate-400 shadow-lg">
          Acting cross-tenant
        </div>
      )}

      {!collapsed && current && !current.linked && (
        <div className="mt-1.5 rounded-xl border border-white/[0.06] bg-admin p-2.5 text-xs text-slate-200 shadow-lg">
          <span className="text-slate-400">“{current.name}” isn’t linked to a Clerk org — customers won’t see it on login. </span>
          {orgs === null ? (
            <button onClick={openLink} className="text-slate-200 underline-offset-2 hover:underline">Link to org</button>
          ) : (
            <select
              className="ml-1 cursor-pointer rounded-full bg-transparent px-1.5 py-0.5 text-xs text-slate-200 hover:bg-white/[0.08] focus:outline-none"
              defaultValue=""
              onChange={(e) => doLink(e.target.value)}
            >
              <option value="" disabled className="text-ink">Select org…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id} disabled={!!o.linkedTo} className="text-ink">
                  {o.name}{o.linkedTo ? ` (linked: ${o.linkedTo})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {!collapsed && open && (
        <div className="mt-2 max-h-96 w-96 overflow-y-auto rounded-xl border border-white/[0.06] bg-admin p-3 text-slate-200 shadow-lg">
          <div className="mb-2 text-xs font-semibold text-slate-200">Activity log</div>
          {entries.length === 0 ? (
            <div className="text-xs text-slate-400">No activity yet</div>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id} className="border-b border-white/[0.06] pb-2 text-xs last:border-0 last:pb-0">
                  <div>
                    <span className="font-medium text-slate-200">{e.actor}</span>
                    <span className="text-slate-400"> · {e.action}</span>
                  </div>
                  {e.reason && <div className="text-slate-400">“{e.reason}”</div>}
                  <div className="text-slate-500">{new Date(e.date).toLocaleString('en-GB')}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
