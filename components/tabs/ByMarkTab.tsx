'use client';
import { useState, useEffect } from 'react';
import styles from './ByMarkTab.module.css';
import { useDashboard } from '../../context/DashboardContext';
import { BADGE_COLORS, getStatusStyle } from '../../lib/utils';

export default function ByMarkTab() {
  const { filteredTrademarks, setSelectedTrademark, focusedMark, setFocusedMark } = useDashboard();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // When sidebar mark is clicked, expand that family
  useEffect(() => {
    if (focusedMark) {
      setExpanded(prev => ({ ...prev, [focusedMark]: true }));
      setFocusedMark(null);
      setTimeout(() => {
        const el = document.getElementById(`mark-family-${focusedMark}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  }, [focusedMark, setFocusedMark]);

  const marksByName: Record<string, typeof filteredTrademarks> = {};
  filteredTrademarks.forEach(t => {
    if (!marksByName[t.mark_text]) marksByName[t.mark_text] = [];
    marksByName[t.mark_text].push(t);
  });

  const toggle = (name: string) => setExpanded(prev => ({ ...prev, [name]: !prev[name] }));

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.dot} />
        <span className={styles.title}>Trademark Marks</span>
        <span className={styles.count}>{Object.keys(marksByName).length}</span>
      </div>

      {Object.entries(marksByName).map(([markName, marks], idx) => {
        const registryNames = Array.from(new Set(marks.map(m => m.registry_name))).join(', ');
        const isExpanded = expanded[markName] ?? false;

        return (
          <div key={markName} id={`mark-family-${markName}`} className={styles.familyCard}>
            <div className={styles.familyHeader} onClick={() => toggle(markName)}>
              <div
                className={styles.familyInitials}
                style={{ backgroundColor: BADGE_COLORS[idx % BADGE_COLORS.length] }}
                aria-hidden="true"
              />
              <div className={styles.familyInfo}>
                <div className={styles.familyName}>{markName}</div>
                <div className={styles.familyMeta}>{registryNames}</div>
              </div>
              <div className={styles.familyCount}>{marks.length} registrations</div>
              <div className={styles.toggle}>{isExpanded ? '▲' : '▼'}</div>
            </div>

            <div className={`${styles.familyBody} ${isExpanded ? styles.familyBodyExpanded : ''}`}>
              {marks.map(mark => {
                const statusStyle = getStatusStyle(mark.status);
                return (
                  <div key={mark.id} className={styles.markRow} onClick={() => setSelectedTrademark(mark)}>
                    <div className={styles.officeTag}>{mark.registry_name}</div>
                    <div className={styles.markNumber}>
                      {mark.registration_number || mark.application_number}
                    </div>
                    <div
                      className={styles.statusBadge}
                      style={{ background: statusStyle.bg, color: statusStyle.color }}
                    >
                      {mark.status}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
