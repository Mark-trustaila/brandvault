'use client';
import { useState, useRef, useCallback } from 'react';

// Sanitise pasted HTML — keep only safe inline formatting
function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(?!\/?(?:b|strong|i|em|u|br|p|div|span)[\s/>])[^>]+>/gi, '')
    .replace(/\s*style="[^"]*"/gi, '')
    .replace(/\s*class="[^"]*"/gi, '');
}
import styles from './DetailPanel.module.css';
import { useDashboard } from '../../context/DashboardContext';
import { useNotes } from '../../hooks/useNotes';
import { formatDate, getStatusStyle, getObligationsForTrademark } from '../../lib/utils';
import { computeCompleteness } from '../../lib/completeness';
import { discrepancyTooltip, reconciliationForMark } from '../../lib/reconciliation';
import WatchNoticeLink from './WatchNoticeLink';
import MarkTile from '../ui/MarkTile';
import type { Trademark } from '../../types/trademark';

const NICE_CLASS_NAMES: Record<number, string> = {
  9: 'Technology', 16: 'Paper goods', 35: 'Business services', 36: 'Financial',
  38: 'Telecommunications', 41: 'Education', 42: 'Software/IT', 45: 'Legal',
};

function NotesSection({ trademark }: { trademark: Trademark }) {
  const { notes, addNote, deleteNote } = useNotes(trademark.id);
  const [linkValue, setLinkValue]     = useState('');
  const [showLink, setShowLink]       = useState(false);
  const [isEmpty, setIsEmpty]         = useState(true);
  const editorRef                     = useRef<HTMLDivElement>(null);

  const handleInput = useCallback(() => {
    const text = editorRef.current?.innerText ?? '';
    setIsEmpty(text.trim() === '');
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html   = e.clipboardData.getData('text/html');
    const plain  = e.clipboardData.getData('text/plain');
    const insert = html ? sanitiseHtml(html) : plain.replace(/\n/g, '<br>');
    document.execCommand('insertHTML', false, insert);
  }, []);

  const handleSave = () => {
    const html = editorRef.current?.innerHTML ?? '';
    const text = editorRef.current?.innerText ?? '';
    if (!text.trim()) return;
    addNote(html, linkValue.trim() || undefined);
    if (editorRef.current) editorRef.current.innerHTML = '';
    setIsEmpty(true);
    setLinkValue('');
    setShowLink(false);
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Notes</div>
      <div className={styles.notesComposer}>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className={styles.noteEditor}
          onInput={handleInput}
          onPaste={handlePaste}
          data-placeholder="Add a note…"
        />
        <div className={styles.composerActions}>
          <button
            className={`${styles.btnLink} ${showLink ? styles.btnLinkActive : ''}`}
            onClick={() => setShowLink(!showLink)}
          >
            🔗 Link
          </button>
          {showLink && (
            <input
              className={styles.noteLinkInput}
              type="url"
              placeholder="https://…"
              value={linkValue}
              onChange={e => setLinkValue(e.target.value)}
            />
          )}
          <button className={styles.btnSave} onClick={handleSave} disabled={isEmpty}>
            Save note
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className={styles.noteEmpty}>No notes yet</div>
      ) : (
        notes.map(note => (
          <div key={note.id} className={styles.noteCard}>
            <div className={styles.noteHeader}>
              <div className={styles.noteAvatar}>{note.author}</div>
              <div className={styles.noteMeta}>
                <span className={styles.noteMetaName}>{note.authorFull}</span>
                {' · '}
                {new Date(note.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
              <button className={styles.noteDelete} onClick={() => deleteNote(note.id)}>×</button>
            </div>
            <div className={styles.noteText} dangerouslySetInnerHTML={{ __html: note.text }} />
            {note.link && (
              <a href={note.link} target="_blank" rel="noopener noreferrer" className={styles.noteLinkChip}>
                🔗 {note.link}
              </a>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function RightsRecord({ trademark }: { trademark: Trademark }) {
  const [activeGsClass, setActiveGsClass] = useState<number | null>(null);
  const statusStyle = getStatusStyle(trademark.status);
  // Registry expiry vs calculated renewal. Where they agree this is inert and
  // the field renders exactly as before.
  const reconciliation = reconciliationForMark(trademark);

  const gsClasses = trademark.good_and_services || [];

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Rights Record</div>
      <div className={styles.grid}>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Status</div>
          <div className={styles.fieldValue}>
            <span className={styles.statusBadge} style={{ background: statusStyle.bg, color: statusStyle.color }}>
              {trademark.status}
            </span>
          </div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Registry</div>
          <div className={styles.fieldValue}>{trademark.registry_name}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Application No.</div>
          <div className={styles.fieldValue}>{trademark.application_number || '—'}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Registration No.</div>
          <div className={styles.fieldValue}>{trademark.registration_number || '—'}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Filing Date</div>
          <div className={styles.fieldValue}>{formatDate(trademark.filing_date)}</div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>Expiry Date</div>
          {reconciliation.datesDiffer ? (
            <>
              <div className={styles.fieldValueFlagged}>
                {formatDate(trademark.expiry_date)}
                <span
                  className={styles.discrepancyIcon}
                  title={discrepancyTooltip(reconciliation, (d) => formatDate(d.toISOString()))}
                  aria-label="Registry and calculated renewal dates differ"
                  role="img"
                >
                  ⚠
                </span>
              </div>
              <div className={styles.calculatedBeneath}>
                Calculated renewal {formatDate(reconciliation.calculatedDue?.toISOString())}
              </div>
            </>
          ) : (
            <div className={styles.fieldValue}>{formatDate(trademark.expiry_date)}</div>
          )}
        </div>
        {trademark.owner_name && (
          <div className={styles.field}>
            <div className={styles.fieldLabel}>Owner</div>
            <div className={styles.fieldValue}>{trademark.owner_name}{trademark.owner_country ? ` · ${trademark.owner_country}` : ''}</div>
          </div>
        )}
        {trademark.representative_name && (
          <div className={styles.field}>
            <div className={styles.fieldLabel}>Representative</div>
            <div className={styles.fieldValue}>{trademark.representative_name}{trademark.representative_reference ? ` · ${trademark.representative_reference}` : ''}</div>
          </div>
        )}
        {gsClasses.length > 0 && (
          <div className={`${styles.field} ${styles.fieldFull}`}>
            <div className={styles.fieldLabel}>Goods &amp; Services</div>
            <div className={styles.gsInlineRow}>
              {gsClasses.map((gs) => {
                const classNum = gs.search_class.number;
                const isActive = activeGsClass === classNum;
                return (
                  <span
                    key={classNum}
                    className={`${styles.gsInlineBadge} ${isActive ? styles.gsInlineBadgeActive : ''}`}
                    onClick={() => setActiveGsClass(isActive ? null : classNum)}
                  >
                    Class {classNum}
                  </span>
                );
              })}
            </div>
            {activeGsClass !== null && (() => {
              const gs = gsClasses.find(g => g.search_class.number === activeGsClass);
              if (!gs) return null;
              return (
                <div className={styles.gsExpandedDetail}>
                  <div className={styles.gsExpandedClassName}>
                    Class {activeGsClass}: {NICE_CLASS_NAMES[activeGsClass] || 'General'}
                  </div>
                  <div>{gs.text}</div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ trademark }: { trademark: Trademark }) {
  const obligations = getObligationsForTrademark(trademark);
  const isRegistered = trademark.status === 'Registered';

  if (isRegistered) {
    return (
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Key Dates</div>
        <div className={styles.compactTimeline}>
          {trademark.filing_date && (
            <span className={styles.ctEvent}>
              <span className={styles.ctLabel}>Filed</span>
              <span className={styles.ctDate}>{formatDate(trademark.filing_date)}</span>
            </span>
          )}
          {trademark.registration_date && (
            <>
              <span className={styles.ctArrow}>→</span>
              <span className={styles.ctEvent}>
                <span className={styles.ctLabel}>Registered</span>
                <span className={styles.ctDate}>{formatDate(trademark.registration_date)}</span>
              </span>
            </>
          )}
          {trademark.expiry_date && (
            <>
              <span className={styles.ctArrow}>→</span>
              <span className={styles.ctEvent}>
                <span className={styles.ctLabel}>Expires</span>
                <span className={styles.ctDate}>{formatDate(trademark.expiry_date)}</span>
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Prosecution Timeline</div>
      {obligations.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {obligations.slice(0, 3).map((ob, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
              border: '1px solid #e8e5e0', borderRadius: 6, marginBottom: 4,
              fontSize: 11, background: '#fff'
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: ob.uncertain ? '#9b9a97' : ob.overdue ? '#eb5757' : ob.actionable ? '#f2994a' : '#0f7b6c'
              }} />
              <span style={{ flex: 1, color: '#37352f', fontWeight: 500 }}>{ob.type}</span>
              <span style={{ color: '#9b9a97', fontSize: 10 }}>
                {ob.uncertain ? 'date required' : formatDate(ob.dueDate ? ob.dueDate.toISOString() : undefined)}
              </span>
              {ob.actionable && (
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: '2px 7px', borderRadius: 8,
                  background: 'rgba(242,153,74,0.1)', color: '#f2994a'
                }}>Due soon</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DetailPanel() {
  const { selectedTrademark, setSelectedTrademark, setEditTarget, breeOpen } = useDashboard();

  if (!selectedTrademark) return null;

  const isRegistered = selectedTrademark.status === 'Registered';
  const statusStyle = getStatusStyle(selectedTrademark.status);

  return (
    <div className={`${styles.overlay} ${styles.overlayOpen}`}>
      <div className={styles.backdrop} onClick={() => setSelectedTrademark(null)} />
      {/* When the Bree panel (360px, right:0) is open, sit alongside it, not over it. */}
      <div className={styles.panel} style={breeOpen ? { right: 360 } : undefined}>
        <div className={styles.header}>
          <MarkTile
            className={styles.headerBadge}
            color="#2e6b8a"
            imageUrl={selectedTrademark.image_url}
            applicationNumber={selectedTrademark.application_number}
          />
          <div className={styles.headerInfo}>
            <h2 className={styles.headerTitle}>{selectedTrademark.mark_text}</h2>
            <div className={styles.headerSub}>
              {selectedTrademark.registry_name} · {selectedTrademark.application_number}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={() => setSelectedTrademark(null)}>×</button>
        </div>

        <div className={styles.body}>
          {(() => {
            const c = computeCompleteness(selectedTrademark);
            return (
              <div style={{ padding: '4px 0 12px', borderBottom: '1px solid #e8e5e0', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9b9a97', marginBottom: 4 }}>
                  <span>Completeness</span>
                  <span>{c.filled}/{c.total} · {c.pct}%</span>
                </div>
                <div style={{ height: 4, background: '#f0efec', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${c.pct}%`, height: '100%', background: c.pct === 100 ? '#0f7b6c' : '#f2994a' }} />
                </div>
                {c.missing.length > 0 && (
                  <div style={{ fontSize: 10, color: '#9b9a97', marginTop: 5 }}>Add: {c.missing.join(', ')}</div>
                )}
              </div>
            );
          })()}
          <WatchNoticeLink trademarkId={selectedTrademark.id} />
          {isRegistered ? (
            <>
              <NotesSection trademark={selectedTrademark} />
              <RightsRecord trademark={selectedTrademark} />
              <Timeline trademark={selectedTrademark} />
            </>
          ) : (
            <>
              <Timeline trademark={selectedTrademark} />
              <RightsRecord trademark={selectedTrademark} />
              <NotesSection trademark={selectedTrademark} />
            </>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.footerBtn} onClick={() => setEditTarget(selectedTrademark)}>✏️ Edit</button>
          <button className={styles.footerBtn}>📋 Copy details</button>
          <button className={styles.footerBtn}>🔗 LawPanel</button>
        </div>
      </div>
    </div>
  );
}
