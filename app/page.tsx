'use client';
import { useDashboard } from '../context/DashboardContext';
import AppShell from '../components/layout/AppShell';
import StatsBar from '../components/dashboard/StatsBar';
import { StatsBarSkeleton, ListSkeleton } from '../components/dashboard/Skeleton';
import EmptyPortfolio from '../components/dashboard/EmptyPortfolio';
import SearchBar from '../components/dashboard/SearchBar';
import TabBar from '../components/dashboard/TabBar';
import ActionsTab from '../components/tabs/ActionsTab';
import ByMarkTab from '../components/tabs/ByMarkTab';
import PipelineTab from '../components/tabs/PipelineTab';
import ByRegistryTab from '../components/tabs/ByRegistryTab';

function Dashboard() {
  // The portfolio fetch moved to AppShell: the sidebar and top bar depend on it
  // too, so every page inside the frame needs it, not just this one.
  const { data, activeTab } = useDashboard();

  return (
    <>
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
            {/* Before the concierge import lands there is nothing to search,
                filter or tab through, and a row of zeroes does not say so.
                Renders nothing once the portfolio has a mark. */}
            <EmptyPortfolio companyName={data.company?.name ?? null} count={data.count} />
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
    </>
  );
}

export default function Page() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
