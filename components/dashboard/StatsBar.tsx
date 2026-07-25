'use client';
import styles from './StatsBar.module.css';
import { useDashboard } from '../../context/DashboardContext';
import { RENEWAL_WINDOW_DAYS, renewalsDueWithin } from '../../lib/utils';

export default function StatsBar() {
  const { data, setActiveTab, setPipelineFilter } = useDashboard();

  if (!data) return null;

  const registered = data.trademarks.filter(t => t.status === 'Registered').length;
  const pending = data.trademarks.filter(t => t.status === 'Pending').length;
  const published = data.trademarks.filter(t => t.status === 'Published').length;
  const needsAction = renewalsDueWithin(data.trademarks, RENEWAL_WINDOW_DAYS).length;

  return (
    <div className={styles.statsRow}>
      {/* 1. Needs Action — most urgent, first */}
      <div
        className={`${styles.card} ${styles.alertTop}`}
        onClick={() => { setPipelineFilter(null); setActiveTab('actions'); }}
      >
        <div className={styles.label}>Needs Action</div>
        <div className={`${styles.value} ${styles.valueAlert}`}>{needsAction}</div>
        <div className={`${styles.sublabel} ${styles.sublabelDown}`}>Renewals &amp; deadlines</div>
      </div>

      {/* 2. Pending / Published */}
      <div
        className={styles.card}
        onClick={() => { setPipelineFilter(null); setActiveTab('pipeline'); }}
      >
        <div className={styles.label}>Pending / Published</div>
        <div className={styles.value}>{pending + published}</div>
        <div className={styles.sublabel}>In prosecution</div>
      </div>

      {/* 3. Registered */}
      <div
        className={styles.card}
        onClick={() => { setPipelineFilter('REGISTERED'); setActiveTab('pipeline'); }}
      >
        <div className={styles.label}>Registered</div>
        <div className={styles.value}>{registered}</div>
        <div className={styles.sublabel}>Active protection</div>
      </div>

      {/* 4. Total Marks */}
      <div
        className={styles.card}
        onClick={() => { setPipelineFilter(null); setActiveTab('by-mark'); }}
      >
        <div className={styles.label}>Total Marks</div>
        <div className={styles.value}>{data.count}</div>
        <div className={styles.sublabel}>{data.count} marks</div>
      </div>
    </div>
  );
}
