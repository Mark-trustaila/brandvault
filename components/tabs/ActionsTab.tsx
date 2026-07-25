'use client';
import styles from './ActionsTab.module.css';
import MarkTile from '../ui/MarkTile';
import { useDashboard } from '../../context/DashboardContext';
import { BADGE_COLORS, calculateDaysRemaining, getDaysBadgeStyle } from '../../lib/utils';

export default function ActionsTab() {
  const { filteredTrademarks, setSelectedTrademark, selectedTrademark } = useDashboard();

  const actionMarks = filteredTrademarks
    .filter(t => {
      const days = calculateDaysRemaining(t.expiry_date);
      return days > 0 && days <= 365;
    })
    .sort((a, b) => calculateDaysRemaining(a.expiry_date) - calculateDaysRemaining(b.expiry_date));

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.dot} />
        <span className={styles.title}>Action required</span>
        <span className={styles.count}>{actionMarks.length}</span>
      </div>

      {actionMarks.length === 0 ? (
        <div className={styles.empty}>No actions required</div>
      ) : (
        <div className={styles.list}>
          {actionMarks.map((mark, idx) => {
            const days = calculateDaysRemaining(mark.expiry_date);
            const badge = getDaysBadgeStyle(days);
            const isSelected = selectedTrademark?.id === mark.id;

            return (
              <div
                key={mark.id}
                className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                onClick={() => setSelectedTrademark(mark)}
              >
                <MarkTile
                  className={styles.initials}
                  color={BADGE_COLORS[idx % BADGE_COLORS.length]}
                  imageUrl={mark.image_url}
                  applicationNumber={mark.application_number}
                />
                <div className={styles.info}>
                  <div className={styles.markName}>{mark.mark_text}</div>
                  <div className={styles.sub}>Renewal due in {days} days</div>
                </div>
                <div
                  className={styles.daysBadge}
                  style={{ backgroundColor: badge.bg, color: badge.color }}
                >
                  {badge.text}
                </div>
                <span className={styles.officeLabel}>{mark.registry_name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
