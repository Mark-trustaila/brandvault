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
import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import styles from './AppShell.module.css';
// The widths themselves live in lib/layout.ts, which globals.css mirrors and a
// test holds to it. Kept out of this file so the tests can read them: a .tsx
// cannot be imported under this project's jsx: preserve.
export { NAV_WIDTH, RAIL_WIDTH, PANEL_WIDTH, CENTRE_FLOOR, PANEL_IN_FLOW_FROM, RAIL_IN_FLOW_FROM } from '../../lib/layout';
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
  const { setData, sidePanelOpen, setSelectedTrademark, setHitPanelOpen } = useDashboard();
  const pathname = usePathname();

  // Going somewhere else closes what was open. Each page mounts its own frame
  // today, so this is belt as well as braces — but "the panel survived a
  // navigation" is a bug that only appears once the frame is hoisted into a
  // shared layout, and by then the cause is three refactors away.
  //
  // Only on an actual change, never on mount: a parent's effect runs after its
  // children's, so an unguarded version would clear the flag the panel had just
  // set on the way up and leave a panel open beside a rail that had not widened.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setSelectedTrademark(null);
    setHitPanelOpen(false);
  }, [pathname, setSelectedTrademark, setHitPanelOpen]);

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
    // The open state is a class on the shell, so the rail's width, the rail's
    // content and the backdrop all follow from one flag in one place.
    <div
      className={`${styles.shell}${sidePanelOpen ? ` ${styles.panelOpen}` : ''}`}
      style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 14, color: '#37352f' }}
    >
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
              {/* Steps aside when a panel takes the column, so the panel
                  replaces the rail's content rather than covering it. */}
              <div data-rail-content style={{ display: 'flex', width: '100%' }}>
                <RightPanel />
              </div>
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
