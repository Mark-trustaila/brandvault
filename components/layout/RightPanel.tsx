'use client';
import styles from './RightPanel.module.css';
import MarkTile from '../ui/MarkTile';
import { useDashboard } from '../../context/DashboardContext';
import {
  BADGE_COLORS,
  RENEWAL_URGENT_DAYS,
  RENEWAL_WINDOW_DAYS,
  calculateDaysRemaining,
  getDaysBadgeStyle,
  formatDate,
  renewalsDueWithin,
} from '../../lib/utils';

export default function RightPanel() {
  const { data, setSelectedTrademark } = useDashboard();

  // Same window and same records as the StatsBar's Needs Action count, so the two
  // always agree. These are individual rights records, not distinct mark names.
  const dueInWindow = renewalsDueWithin(data?.trademarks ?? [], RENEWAL_WINDOW_DAYS)
    .sort((a, b) => calculateDaysRemaining(a.expiry_date) - calculateDaysRemaining(b.expiry_date));
  const dueCount = dueInWindow.length;
  const urgentCount = renewalsDueWithin(dueInWindow, RENEWAL_URGENT_DAYS).length;
  const upcomingRenewals = dueInWindow.slice(0, 5);

  const registryCount = new Set(data?.trademarks.map(t => t.registry_name)).size;
  const class9count = data?.trademarks.filter(t =>
    t.good_and_services?.some(g => g.search_class.number === 9)
  ).length ?? 0;
  const class42count = data?.trademarks.filter(t =>
    t.good_and_services?.some(g => g.search_class.number === 42)
  ).length ?? 0;

  return (
    <aside className={styles.panel}>
      <div className={styles.sectionTitle}>BrandVault Intelligence</div>

      <div>
        <div className={styles.alertTitle}>BrandVault Alert</div>
        <div className={`${styles.alertCard} ${urgentCount > 0 ? styles.alertCardUrgent : ''}`}>
          <div className={styles.alertText}>
            {dueCount} renewal {dueCount === 1 ? 'deadline' : 'deadlines'} in the next 12 months.
            {urgentCount > 0 && (
              <>
                {' '}
                <span className={styles.alertUrgent}>
                  {urgentCount} {urgentCount === 1 ? 'falls' : 'fall'} due within 60 days.
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className={styles.alertTitle}>Portfolio Insight</div>
        <div className={styles.alertCard}>
          <div className={styles.alertText}>
            {data?.trademarks.filter(t => t.status === 'Registered').length ?? 0} registered marks across {registryCount} registries.
            Strongest coverage in Class {class9count >= class42count ? 9 : 42} and Class {class9count >= class42count ? 42 : 9}.
          </div>
        </div>
      </div>

      <div>
        <div className={styles.alertTitle}>Data Source</div>
        <div className={styles.alertCard}>
          <div className={styles.alertText}>
            Live from the BrandVault database. Last loaded: {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleDateString('en-GB') : '—'}.
          </div>
        </div>
      </div>

      <div>
        <div className={styles.viewAll}>
          <div className={styles.sectionTitle}>Upcoming Renewals</div>
          <span className={styles.viewAllLink}>View all →</span>
        </div>
        {upcomingRenewals.length > 0 ? (
          <div className={styles.renewalList}>
            {upcomingRenewals.map((t, idx) => {
              const days = calculateDaysRemaining(t.expiry_date);
              const badge = getDaysBadgeStyle(days);
              return (
                <div key={t.id} className={styles.renewalItem} onClick={() => setSelectedTrademark(t)}>
                  <MarkTile
                    className={styles.renewalInitials}
                    color={BADGE_COLORS[idx % BADGE_COLORS.length]}
                    imageUrl={t.image_url}
                    applicationNumber={t.application_number}
                  />
                  <div className={styles.renewalInfo}>
                    <div className={styles.renewalTitle}>{t.mark_text}</div>
                    <div className={styles.renewalSub}>{t.registry_name} · {formatDate(t.expiry_date)}</div>
                  </div>
                  <div className={styles.renewalDays} style={{ background: badge.bg, color: badge.color }}>
                    {badge.text}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyState}>No renewals due in the next 12 months</div>
        )}
      </div>

      {/* Actionable Deadlines is hidden by default: the only source for it is the
          Deadlines table, which currently disagrees with the registry expiry dates
          this panel counts (see the expiry/deadline divergence). Showing an empty
          section under a line stating N deadlines exist reads as a contradiction.
          Flip NEXT_PUBLIC_SHOW_ACTIONABLE_DEADLINES=true once it is computed. */}
      {process.env.NEXT_PUBLIC_SHOW_ACTIONABLE_DEADLINES === 'true' && (
        <div>
          <div className={styles.sectionTitle}>Actionable Deadlines</div>
          <div className={styles.emptyState}>No actionable deadlines in the next 6 months</div>
        </div>
      )}
    </aside>
  );
}
