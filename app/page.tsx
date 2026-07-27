'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { DashboardProvider, useDashboard } from '../context/DashboardContext';
import Sidebar from '../components/layout/Sidebar';
import Topbar from '../components/layout/Topbar';
import RightPanel from '../components/layout/RightPanel';
import StatsBar from '../components/dashboard/StatsBar';
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
import { bvFetch } from '../lib/client/acting-company';

function Dashboard() {
  const { data, setData, activeTab } = useDashboard();

  useEffect(() => {
    bvFetch('/api/trademarks')
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
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
            <StatsBar />
            <SearchBar />
            <TabBar />
            <div>
              {activeTab === 'actions' && <ActionsTab />}
              {activeTab === 'by-mark' && <ByMarkTab />}
              {activeTab === 'pipeline' && <PipelineTab />}
              {activeTab === 'by-registry' && <ByRegistryTab />}
            </div>
            {/* Quiet footer link. Deliberately below the content and unstyled
                beyond grey text: it is there for someone who goes looking. */}
            <footer className="mt-10 border-t border-slate-100 pt-4 text-xs text-slate-400">
              <Link href="/whats-new" className="hover:text-slate-600">What&rsquo;s new</Link>
            </footer>
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
