'use client';
import { useRouter } from 'next/navigation';
import styles from './Topbar.module.css';
import { useDashboard } from '../../context/DashboardContext';
import { AuthControls } from '../auth/AuthControls';
const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline-block', verticalAlign:'middle', marginRight:4}}>
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconReport = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'inline-block', verticalAlign:'middle', marginRight:4}}>
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);
export default function Topbar() {
  const { data, setShowReport, setEditTarget } = useDashboard();
  const router = useRouter();

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <div className={styles.breadcrumb}>
          <span>BrandVault</span>
          <span>/ {data?.company?.name ?? 'BrandVault'}</span>
          <span>/ Dashboard</span>
        </div>
      </div>
      <div className={styles.right}>
        <div className={styles.badge}>✓ Live</div>
        <button className={styles.btn} onClick={() => setShowReport(true)}><IconReport /> Report</button>
        <button className={`${styles.btn} ${styles.btnDisabled}`}>⚙ Settings</button>
        {/* The two things someone comes here to start. Independent: searching a
            register needs no mark, and adding a mark needs no search.
            Both take the same outline style as Report and Settings. A filled
            button is a claim about where the eye should go, and neither of these
            is the one thing this screen wants you to do. */}
        <button className={styles.btn} onClick={() => router.push('/clearance')}>
          <IconSearch /> Registry search
        </button>
        <button className={styles.btn} onClick={() => setEditTarget('new')}>+ New mark</button>
        <AuthControls />
      </div>
    </header>
  );
}
