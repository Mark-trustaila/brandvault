'use client';

/**
 * The application frame: admin bar, sidebar, top bar, right rail, and the
 * overlays that can open over any page.
 *
 * Extracted from app/page.tsx, which composed all of this inline. That was
 * fine while the dashboard was the only page inside the frame, and stopped
 * being fine the moment a second one needed it: registry search rendered as a
 * bare document with a "back to dashboard" link, which reads as a different
 * product rather than another room in the same one.
 *
 * Only the main content area changes between pages. The frame — including the
 * right rail and the detail panel — persists, so navigating does not feel like
 * leaving.
 *
 * The portfolio fetch lives here rather than in a page, because the frame
 * itself depends on it: the sidebar counts marks and the top bar names the
 * company. A page that forgot to fetch would show a frame that quietly said
 * "BrandVault" where every other page says the customer's name.
 */
import { useEffect, type ReactNode } from 'react';
import styles from './AppShell.module.css';
// The widths themselves live in lib/layout.ts, which globals.css mirrors and a
// test holds to it. Kept out of this file so the tests can read them: a .tsx
// cannot be imported under this project's jsx: preserve.
export { NAV_WIDTH, RAIL_WIDTH, RAIL_WIDTH_NARROW, CENTRE_FLOOR, RAIL_FULL_FROM, RAIL_IN_FLOW_FROM } from '../../lib/layout';
import { DashboardProvider, useDashboard } from '../../context/DashboardContext';
import { PlatformAdminBar } from '../admin/PlatformAdminBar';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import RightPanel from './RightPanel';
import DetailPanel from '../detail/DetailPanel';
import ReportPanel from '../report/ReportPanel';
import { MarkEditForm } from '../detail/MarkEditForm';
import BreeWidget from '../bree/BreeWidget';
import type { TrademarkData } from '../../types/trademark';
import { bvFetch, getActingCompany } from '../../lib/client/acting-company';
import { cacheKey, staleWhileRevalidate } from '../../lib/client/dashboard-cache';

function Frame({ children, rightRail = true, overlay }: {
  children: ReactNode;
  /** The dashboard's insight rail. Present by default: it is frame furniture. */
  rightRail?: boolean;
  /** A page-owned panel that opens over the frame, beside the shared ones. */
  overlay?: ReactNode;
}) {
  const { setData } = useDashboard();

  // Render from the last portfolio instantly, then refresh in the background.
  useEffect(() => {
    const key = cacheKey('trademarks', getActingCompany()?.id ?? null);
    staleWhileRevalidate<TrademarkData>(
      key,
      () => bvFetch('/api/trademarks').then((r) => (r.ok ? r.json() : null)),
      setData,
    );
  }, [setData]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 14, color: '#37352f' }}>
      <PlatformAdminBar />
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar />
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div className={styles.centre}>
            {children}
          </div>
          {rightRail && (
            <div className={styles.railBox}>
              <RightPanel />
            </div>
          )}
        </div>
      </div>
      {/* Shared overlays. Any page inside the frame can open a mark, a report
          or the edit form, so they hang off the frame rather than the page. */}
      <DetailPanel />
      <ReportPanel />
      <MarkEditForm />
      <BreeWidget />
      {overlay}
    </div>
  );
}

/** The frame plus the context it needs. What a page renders into. */
export default function AppShell(props: {
  children: ReactNode;
  rightRail?: boolean;
  overlay?: ReactNode;
}) {
  return (
    <DashboardProvider>
      <Frame {...props} />
    </DashboardProvider>
  );
}
