'use client';
import { useEffect, useState } from 'react';
import { useDashboard } from '../../context/DashboardContext';
import { bvFetch } from '../../lib/client/acting-company';
import { computeRenewalDate } from '../../lib/renewal-rules';
import type { Trademark } from '../../types/trademark';

const STATUSES = ['Registered', 'Pending', 'Published', 'Expired', 'Abandoned'] as const;
type GoodsRow = { classNumber: string; text: string };
type Family = { id: string; name: string; markCount: number };

const dstr = (iso?: string) => (iso ? iso.slice(0, 10) : '');

/**
 * Create / edit / delete a mark, plus goods & services and family assignment.
 * Opened via the dashboard `editTarget` ('new' or a Trademark). New component:
 * Tailwind only (composed alongside the CSS-Module DetailPanel).
 */
export function MarkEditForm() {
  const { editTarget, setEditTarget, setData, setSelectedTrademark } = useDashboard();
  const editing = editTarget && editTarget !== 'new' ? (editTarget as Trademark) : null;
  const isOpen = editTarget !== null;

  const [f, setF] = useState({
    markText: '', registryName: '', status: 'Pending', applicationNumber: '',
    registrationNumber: '', filingDate: '', registrationDate: '', expiryDate: '', clientAgentName: '', familyId: '',
    ownerName: '', ownerCountry: '', representativeName: '', representativeReference: '',
  });
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [newFamily, setNewFamily] = useState('');
  const [goods, setGoods] = useState<GoodsRow[]>([]);
  const [reason, setReason] = useState('');
  const [families, setFamilies] = useState<Family[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /**
   * True once `goods` reflects the mark's real specifications.
   *
   * The list payload carries class numbers without text, so the rows seeded
   * from it would be dropped by the save filter and replace real
   * specifications with nothing. Until the full record arrives, the payload
   * omits goodsServices entirely, which PATCH treats as "leave them alone".
   */
  const [goodsHydrated, setGoodsHydrated] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setErr(''); setNewFamily(''); setReason(''); setExpiryTouched(false);
    if (editing) {
      setF({
        markText: editing.mark_text ?? '', registryName: editing.registry_name ?? '',
        status: editing.status ?? 'Pending', applicationNumber: editing.application_number ?? '',
        registrationNumber: editing.registration_number ?? '', filingDate: dstr(editing.filing_date),
        registrationDate: dstr(editing.registration_date), expiryDate: dstr(editing.expiry_date),
        clientAgentName: editing.client_agent_name ?? '', familyId: editing.family_id ?? '',
        ownerName: editing.owner_name ?? '', ownerCountry: editing.owner_country ?? '',
        representativeName: editing.representative_name ?? '', representativeReference: editing.representative_reference ?? '',
      });
      // Seed from what the list has so the classes render immediately, then
      // hydrate the specification text from the full record.
      setGoods((editing.good_and_services ?? []).map((g) => ({ classNumber: String(g.search_class.number), text: g.text ?? '' })));
      setGoodsHydrated(false);
      bvFetch(`/api/trademarks/${editing.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((full: Trademark | null) => {
          if (!full) return;
          // Do not clobber typing: if any row already has text, either the
          // user has started editing or hydration already ran.
          const hydrated = (full.good_and_services ?? []).map((g) => ({ classNumber: String(g.search_class.number), text: g.text ?? '' }));
          setGoods((cur) => (cur.some((g) => g.text.trim()) ? cur : hydrated));
          setGoodsHydrated(true);
        })
        .catch(() => {});
    } else {
      setF({ markText: '', registryName: '', status: 'Pending', applicationNumber: '', registrationNumber: '', filingDate: '', registrationDate: '', expiryDate: '', clientAgentName: '', familyId: '', ownerName: '', ownerCountry: '', representativeName: '', representativeReference: '' });
      setGoods([]);
      setGoodsHydrated(true); // a new mark has no specifications to preserve
    }
    bvFetch('/api/families').then((r) => r.json()).then((d) => setFamilies(d.families ?? [])).catch(() => {});
  }, [editTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  // update a field; recompute expiry from registry+dates unless the user edited expiry
  const set = (key: keyof typeof f, val: string) => {
    setF((prev) => {
      const next = { ...prev, [key]: val };
      if (key === 'expiryDate') setExpiryTouched(true);
      if ((key === 'registryName' || key === 'filingDate' || key === 'registrationDate') && !expiryTouched) {
        const auto = computeRenewalDate(next.registryName, next.filingDate, next.registrationDate);
        if (auto) next.expiryDate = auto;
      }
      return next;
    });
  };

  const refresh = () => bvFetch('/api/trademarks').then((r) => r.json()).then(setData).catch(() => {});
  const close = () => { setEditTarget(null); setSelectedTrademark(null); };

  const save = async () => {
    if (!f.markText.trim() || !f.registryName.trim()) { setErr('Mark and registry are required.'); return; }
    setBusy(true); setErr('');
    let familyId = f.familyId;
    if (newFamily.trim()) {
      const fr = await bvFetch('/api/families', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ familyName: newFamily.trim(), reason: reason.trim() || undefined }) });
      if (!fr.ok) { setBusy(false); setErr('Could not create family.'); return; }
      familyId = (await fr.json()).id;
    }
    const payload = {
      markText: f.markText.trim(), registryName: f.registryName.trim(), status: f.status,
      applicationNumber: f.applicationNumber.trim() || null, registrationNumber: f.registrationNumber.trim() || null,
      filingDate: f.filingDate || null, registrationDate: f.registrationDate || null, expiryDate: f.expiryDate || null,
      clientAgentName: f.clientAgentName.trim() || null, familyId: familyId || null,
      ownerName: f.ownerName.trim() || null, ownerCountry: f.ownerCountry.trim() || null,
      representativeName: f.representativeName.trim() || null, representativeReference: f.representativeReference.trim() || null,
      // Only sent once hydrated. PATCH replaces goods when the key is present
      // and leaves them untouched when it is absent, so omitting it is what
      // stops a not-yet-loaded form wiping real specifications.
      ...(goodsHydrated
        ? { goodsServices: goods.filter((g) => g.classNumber && g.text.trim()).map((g) => ({ classNumber: Number(g.classNumber), text: g.text.trim() })) }
        : {}),
      reason: reason.trim() || undefined,
    };
    const res = editing
      ? await bvFetch(`/api/trademarks/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      : await bvFetch('/api/trademarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!res.ok) { setErr((await res.json().catch(() => ({}))).error || 'Save failed.'); return; }
    await refresh(); close();
  };

  const remove = async () => {
    if (!editing || !window.confirm(`Delete "${editing.mark_text}" (${editing.registry_name})? This cannot be undone.`)) return;
    setBusy(true); setErr('');
    const q = reason.trim() ? `?reason=${encodeURIComponent(reason.trim())}` : '';
    const res = await bvFetch(`/api/trademarks/${editing.id}${q}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok && res.status !== 204) { setErr((await res.json().catch(() => ({}))).error || 'Delete failed.'); return; }
    await refresh(); close();
  };

  const input = 'w-full rounded border border-line bg-surface px-2 py-1 text-sm text-ink';
  const label = 'block text-xs font-medium text-ink-muted mb-1';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/30 p-6 font-sans">
      <div className="my-6 w-full max-w-2xl rounded-lg bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{editing ? 'Edit mark' : 'New mark'}</h2>
          <button onClick={close} className="text-ink-subtle hover:text-ink">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className={label}>Mark *</label><input className={input} value={f.markText} onChange={(e) => set('markText', e.target.value)} /></div>
          <div><label className={label}>Registry *</label><input className={input} value={f.registryName} onChange={(e) => set('registryName', e.target.value)} placeholder="UKIPO" /></div>
          <div><label className={label}>Status</label><select className={input} value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><label className={label}>Application no.</label><input className={input} value={f.applicationNumber} onChange={(e) => set('applicationNumber', e.target.value)} /></div>
          <div><label className={label}>Registration no.</label><input className={input} value={f.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} /></div>
          <div><label className={label}>Filing date</label><input type="date" className={input} value={f.filingDate} onChange={(e) => set('filingDate', e.target.value)} /></div>
          <div><label className={label}>Registration date</label><input type="date" className={input} value={f.registrationDate} onChange={(e) => set('registrationDate', e.target.value)} /></div>
          <div><label className={label}>Expiry (auto from registry+dates)</label><input type="date" className={input} value={f.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} /></div>
          <div><label className={label}>Client / agent</label><input className={input} value={f.clientAgentName} onChange={(e) => set('clientAgentName', e.target.value)} /></div>
          <div><label className={label}>Family</label>
            <select className={input} value={f.familyId} onChange={(e) => set('familyId', e.target.value)} disabled={!!newFamily.trim()}>
              <option value="">— none —</option>
              {families.map((fam) => <option key={fam.id} value={fam.id}>{fam.name}</option>)}
            </select>
          </div>
          <div><label className={label}>…or new family</label><input className={input} value={newFamily} onChange={(e) => setNewFamily(e.target.value)} placeholder="Create + assign" /></div>

          <div className="col-span-2 mt-1 border-t border-line pt-2 text-xs font-medium text-ink-muted">Owner &amp; representative</div>
          <div><label className={label}>Owner name</label><input className={input} value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} /></div>
          <div><label className={label}>Owner country</label><input className={input} value={f.ownerCountry} onChange={(e) => set('ownerCountry', e.target.value)} /></div>
          <div><label className={label}>Representative name</label><input className={input} value={f.representativeName} onChange={(e) => set('representativeName', e.target.value)} /></div>
          <div><label className={label}>Representative reference</label><input className={input} value={f.representativeReference} onChange={(e) => set('representativeReference', e.target.value)} /></div>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <span className={label}>Goods &amp; services</span>
            <button onClick={() => setGoods((g) => [...g, { classNumber: '', text: '' }])} className="text-xs text-brand hover:underline">+ Add class</button>
          </div>
          {goods.length === 0 && <div className="text-xs text-ink-subtle">None</div>}
          {goods.map((g, i) => (
            <div key={i} className="mb-1 flex gap-2">
              <input className={`${input} w-20`} type="number" placeholder="Class" value={g.classNumber} onChange={(e) => setGoods((gs) => gs.map((x, j) => (j === i ? { ...x, classNumber: e.target.value } : x)))} />
              <input className={input} placeholder="Description" value={g.text} onChange={(e) => setGoods((gs) => gs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <button onClick={() => setGoods((gs) => gs.filter((_, j) => j !== i))} className="text-ink-subtle hover:text-status-expired">✕</button>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <label className={label}>Reason (required when acting as a platform admin)</label>
          <input className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {err && <div className="mt-3 text-xs text-status-expired">{err}</div>}

        <div className="mt-5 flex items-center justify-between">
          {editing ? (
            <button onClick={remove} disabled={busy} className="rounded border border-status-expired px-3 py-1 text-xs text-status-expired hover:bg-status-expired/5 disabled:opacity-50">Delete mark</button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={close} disabled={busy} className="rounded border border-line px-3 py-1 text-sm text-ink-muted hover:text-ink">Cancel</button>
            <button onClick={save} disabled={busy} className="rounded bg-brand px-4 py-1 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
