'use client';
import { useEffect } from 'react';
import { DashboardProvider, useDashboard } from '../context/DashboardContext';
import Sidebar from '../components/layout/Sidebar';
import Topbar from '../components/layout/Topbar';
import RightPanel from '../components/layout/RightPanel';
import StatsBar from '../components/dashboard/StatsBar';
import { StatsBarSkeleton, ListSkeleton } from '../components/dashboard/Skeleton';
import SearchBar from '../components/dashboard/SearchBar';
import TabBar from '../components/dashboard/TabBar';
import ActionsTab from '../components/tabs/ActionsTab';
import ByMarkTab from '../components/tabs/ByMarkTab';
import PipelineTab from '../components/tabs/PipelineTab';
import ByRegistryTab from '../components/tabs/ByRegistryTab';
import DetailPanel from '../components/detail/DetailPanel';
import ReportPanel from '../components/report/ReportPanel';
import { MarkEditForm } from '../components/detail/MarkEditForm';
import { PlatformAdminBar } from '../components/admin/PlatformAdminBar';
import BreeWidget from '../components/bree/BreeWidget';
import type { TrademarkData } from '../types/trademark';
import { bvFetch, getActingCompany } from '../lib/client/acting-company';
import { cacheKey, staleWhileRevalidate } from '../lib/client/dashboard-cache';

function Dashboard() {
  const { data, setData, activeTab } = useDashboard();

  // Render from the last portfolio instantly, then refresh in the background.
  useEffect(() => {
    const key = cacheKey('trademarks', getActingCompany()?.id ?? null);
    staleWhileRevalidate<TrademarkData>(
      key,
      () => bvFetch('/api/trademarks').then(r => (r.ok ? r.json() : null)),
      setData
    );
  }, [setData]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 14, color: '#37352f' }}>
      <PlatformAdminBar />
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar />
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#37352f', marginBottom: 2 }}>{data?.company?.name ?? 'BrandVault'}</h1>
            <p style={{ fontSize: 12, color: '#9b9a97', marginBottom: 14 }}>
              Trademark portfolio overview
            </p>
            {/* First uncached load only. With a cache hit `data` is already
                populated on the first paint and these never render. */}
            {!data ? (
              <>
                <StatsBarSkeleton />
                <SearchBar />
                <TabBar />
                <ListSkeleton />
              </>
            ) : (
              <>
                <StatsBar />
                <SearchBar />
                <TabBar />
                <div>
                  {activeTab === 'actions' && <ActionsTab />}
                  {activeTab === 'by-mark' && <ByMarkTab />}
                  {activeTab === 'pipeline' && <PipelineTab />}
                  {activeTab === 'by-registry' && <ByRegistryTab />}
                </div>
              </>
            )}
            {/* The changelog link used to sit here, below the tab content. Once
                the portfolio loaded it was pushed past the fold and effectively
                vanished. It now lives in the sidebar's scroll container. */}
          </div>
          <RightPanel />
        </div>
      </div>
      <DetailPanel />
      <ReportPanel />
      <MarkEditForm />
      <BreeWidget />
    </div>
  );
}

export default function Page() {
  return (
    <DashboardProvider>
      <Dashboard />
    </DashboardProvider>
  );
}
