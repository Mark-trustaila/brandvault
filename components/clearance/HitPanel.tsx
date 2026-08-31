'use client';

/**
 * One registry-search result, opened in the right-hand panel.
 *
 * Uses DetailPanel.module.css directly rather than a lookalike, so a result
 * opens exactly as a portfolio mark does: same position, same width, same
 * backdrop, same header and footer chrome, same close behaviour. A panel that
 * merely resembled the other one would drift the first time either was
 * restyled, and the two would slowly stop being the same gesture.
 *
 * That is a deliberate exception to "new components use Tailwind". The point of
 * that rule is to stop the two styling systems mixing inside one component;
 * this component uses one system, the existing one, because matching an
 * existing surface exactly is the requirement.
 *
 * Previous and next in the header walk the results without closing, because
 * reviewing twenty of them means twenty decisions and returning to the list
 * between each one loses the reader's place. Nothing in the list changes while
 * the panel is open.
 *
 * The specification comes from the registry facade, which implements GB only.
 * A WO result shows what the search returned plus the register link, and says
 * the specification is not available for that register — never a blank section,
 * which would read as a mark with no goods.
 */
import { useCallback, useEffect, useState } from 'react';
import styles from '../detail/DetailPanel.module.css';
import { useDashboard } from '../../context/DashboardContext';
import { hitMarkText, hitClassesLabel, type SmartSearchHit } from '../../lib/smart-search-hit';
import { registerDeepLink, registryLabel } from '../../lib/smart-search-registries';
import { TIERS, TIER_LABEL, isExactMatch, type HitReview, type Tier } from '../../lib/clearance-review';
import { bvFetch } from '../../lib/client/acting-company';

type Lookup = {
  available: boolean;
  found?: boolean;
  reason?: string;
  mark?: any;
  ownerMarks?: Array<{ ownerString: string; markCount: number }>;
  error?: string;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pickDates(mark: any): Array<{ label: string; value: string }> {
  const dates: Array<{ path: string; value: string }> = mark?.dates ?? [];
  const wanted: Array<[RegExp, string]> = [
    [/RegistrationDate/i, 'Registered'],
    [/ExpiryDate|RenewalDate/i, 'Renewal due'],
    [/PublicationDate/i, 'Published'],
  ];
  const out: Array<{ label: string; value: string }> = [];
  for (const [re, label] of wanted) {
    const found = dates.find((d) => re.test(d.path));
    if (found) out.push({ label, value: formatDate(found.value) });
  }
  return out;
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
  const { breeOpen } = useDashboard();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [note, setNote] = useState(review?.note ?? '');
  const appNo = hit.application_number;

  // Reset per result: stepping to the next one must not carry the previous
  // note into a different mark's textarea.
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
    <div className={`${styles.overlay} ${styles.overlayOpen}`}>
      <div className={styles.backdrop} onClick={onClose} />
      {/* Sits beside the Bree panel when it is open, exactly as DetailPanel does. */}
      <div className={styles.panel} style={breeOpen ? { right: 360 } : undefined}>
        <div className={styles.header}>
          <div className={styles.headerInfo}>
            <h2 className={styles.headerTitle}>
              {hitMarkText(hit) || '[no verbal element]'}
              {isExactMatch(hit) && (
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 8, background: 'rgba(235,87,87,0.1)', color: '#eb5757' }}>
                  identical
                </span>
              )}
            </h2>
            <div className={styles.headerSub}>
              {registryLabel(registry)} · {appNo} · score {hit.score}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* The stepper gets its own strip rather than competing with the title
            for the header's 292px of content width. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 24px', borderBottom: '1px solid #e8e5e0', flexShrink: 0,
        }}>
          <button className={styles.footerBtn} onClick={onPrev} disabled={!onPrev} aria-label="Previous result">←</button>
          <button className={styles.footerBtn} onClick={onNext} disabled={!onNext} aria-label="Next result">→</button>
          <span style={{ fontSize: 11, color: '#9b9a97', marginLeft: 'auto' }}>{index + 1} of {total}</span>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>The mark</div>
            <div className={styles.grid}>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Owner</div>
                <div className={styles.fieldValue}>{hit.owner ?? 'not recorded'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Status</div>
                <div className={styles.fieldValue}>{hit.status || '—'}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Application</div>
                <div className={styles.fieldValue}>{appNo}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Filed</div>
                <div className={styles.fieldValue}>{formatDate(hit.application_date)}</div>
              </div>
              <div className={styles.field}>
                <div className={styles.fieldLabel}>Classes</div>
                <div className={styles.fieldValue}>{hitClassesLabel(hit) || '—'}</div>
              </div>
              {pickDates(lookup?.mark).map((d) => (
                <div className={styles.field} key={d.label}>
                  <div className={styles.fieldLabel}>{d.label}</div>
                  <div className={styles.fieldValue}>{d.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Goods and services</div>
            {lookup === null ? (
              <div style={{ fontSize: 12, color: '#9b9a97' }}>Reading the register…</div>
            ) : !lookup.available ? (
              <div style={{ fontSize: 12, color: '#b7791f' }}>{lookup.reason ?? 'Not available for this register.'}</div>
            ) : lookup.error ? (
              <div style={{ fontSize: 12, color: '#b7791f' }}>The register could not be read: {lookup.error}</div>
            ) : lookup.found === false ? (
              <div style={{ fontSize: 12, color: '#b7791f' }}>
                No record for {appNo} in the corpus. While UK009 coverage is partial that is not proof the mark does not
                exist — check the register directly before relying on it.
              </div>
            ) : spec.length === 0 ? (
              <div style={{ fontSize: 12, color: '#9b9a97' }}>The record carries no specification text.</div>
            ) : (
              <div>
                {spec.map((g, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#37352f' }}>Class {g.class_number}</div>
                    <div style={{ fontSize: 12, color: '#6b6a67', lineHeight: 1.5 }}>{g.description}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(lookup?.ownerMarks?.length ?? 0) > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>What else this owner holds</div>
              {lookup!.ownerMarks!.slice(0, 8).map((o) => (
                <div key={o.ownerString} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, padding: '3px 0' }}>
                  <span style={{ color: '#37352f' }}>{o.ownerString}</span>
                  <span style={{ color: '#9b9a97', whiteSpace: 'nowrap' }}>{o.markCount} marks</span>
                </div>
              ))}
            </div>
          )}

          {onReview && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Your review</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {TIERS.map((t) => (
                  <button
                    key={t}
                    className={styles.footerBtn}
                    onClick={() => onReview({ tier: t })}
                    style={tier === t ? { borderColor: '#37352f', color: '#37352f', fontWeight: 600 } : undefined}
                  >
                    {TIER_LABEL[t]}
                  </button>
                ))}
              </div>
              <textarea
                className={styles.noteEditor}
                rows={3}
                placeholder="Why this matters, or why it does not…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => { if (note !== (review?.note ?? '')) onReview({ note }); }}
                style={{ width: '100%', minHeight: 64 }}
              />
              <div style={{ fontSize: 10, color: '#9b9a97', marginTop: 4 }}>Saved when you click away.</div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {link && (
            <a className={styles.footerBtn} href={link} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              🔗 Open on the register
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
