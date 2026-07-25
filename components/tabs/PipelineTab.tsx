'use client';
import styles from './PipelineTab.module.css';
import MarkTile from '../ui/MarkTile';
import { useDashboard } from '../../context/DashboardContext';
import { BADGE_COLORS, getStatusStyle } from '../../lib/utils';

const PIPELINE_STAGES = [
  { key: 'FILED', label: 'Filed' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'REGISTERED', label: 'Registered' },
  { key: 'ABANDONED', label: 'Abandoned' },
];

export default function PipelineTab() {
  const { filteredTrademarks, pipelineFilter, setPipelineFilter, setSelectedTrademark } = useDashboard();

  const counts: Record<string, number> = {};
  filteredTrademarks.forEach(t => {
    const key = t.status.toUpperCase();
    counts[key] = (counts[key] || 0) + 1;
  });

  const getBubbleClass = (key: string) => {
    const base = styles.bubble;
    const selected = pipelineFilter === key ? styles.bubbleSelected : '';
    if (key === 'REGISTERED') return `${base} ${styles.bubbleHighlight} ${selected}`;
    if (key === 'ABANDONED' || key === 'EXPIRED') return `${base} ${styles.bubbleWarning} ${selected}`;
    if (counts[key] > 0) return `${base} ${styles.bubbleActive} ${selected}`;
    return `${base} ${selected}`;
  };

  const handleStageClick = (key: string) => {
    setPipelineFilter(pipelineFilter === key ? null : key);
  };

  const matchingMarks = pipelineFilter
    ? filteredTrademarks.filter(t => t.status.toUpperCase() === pipelineFilter)
    : [];

  return (
    <div>
      <div className={styles.container}>
        {PIPELINE_STAGES.map((stage, idx) => (
          <>
            <div key={stage.key} className={styles.stage} onClick={() => handleStageClick(stage.key)}>
              <div className={getBubbleClass(stage.key)}>
                {counts[stage.key] || 0}
              </div>
              <div className={styles.stageLabel}>{stage.label}</div>
            </div>
            {idx < PIPELINE_STAGES.length - 1 && (
              <div key={`arrow-${idx}`} className={styles.arrow}>→</div>
            )}
          </>
        ))}
      </div>

      {pipelineFilter && (
        <div className={styles.filteredList}>
          <div className={styles.filteredHeader}>
            {pipelineFilter.charAt(0) + pipelineFilter.slice(1).toLowerCase()}
            <span className={styles.pfCount}>{matchingMarks.length}</span>
            <span className={styles.pfClear} onClick={() => setPipelineFilter(null)}>✕ Clear filter</span>
          </div>
          {matchingMarks.map((mark, idx) => {
            const statusStyle = getStatusStyle(mark.status);
            return (
              <div key={mark.id} className={styles.markRow} onClick={() => setSelectedTrademark(mark)}>
                <MarkTile
                  className={styles.initials}
                  color={BADGE_COLORS[idx % BADGE_COLORS.length]}
                  imageUrl={mark.image_url}
                  applicationNumber={mark.application_number}
                />
                <div className={styles.markInfo}>
                  <div className={styles.markName}>{mark.mark_text}</div>
                  <div className={styles.markSub}>{mark.registry_name} · {mark.application_number}</div>
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
      )}
    </div>
  );
}
