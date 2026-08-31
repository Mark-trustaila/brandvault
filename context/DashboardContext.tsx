'use client';
import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import type { Trademark, TrademarkData } from '../types/trademark';
import { matchesSearch } from '../lib/utils';
import { searchQueryFromUrl } from '../lib/deep-links';

interface DashboardContextType {
  data: TrademarkData | null;
  setData: (data: TrademarkData) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  pipelineFilter: string | null;
  setPipelineFilter: (f: string | null) => void;
  selectedTrademark: Trademark | null;
  setSelectedTrademark: (t: Trademark | null) => void;
  showReport: boolean;
  setShowReport: (s: boolean) => void;
  editTarget: Trademark | 'new' | null; // open the edit form (existing mark or a new one)
  setEditTarget: (t: Trademark | 'new' | null) => void;
  filteredTrademarks: Trademark[];
  focusedMark: string | null;
  setFocusedMark: (mark: string | null) => void;
  breeOpen: boolean;
  setBreeOpen: (open: boolean) => void;
  /**
   * A page-owned slide-over is open — the registry-search hit panel. Set by
   * that panel; the portfolio's own DetailPanel is inferred from
   * selectedTrademark and needs no flag.
   */
  hitPanelOpen: boolean;
  setHitPanelOpen: (open: boolean) => void;
  /**
   * Either slide-over is open. Bree's floating button reads this to step out
   * from under whichever one it is, without needing to know which.
   */
  sidePanelOpen: boolean;
}

const DashboardContext = createContext<DashboardContextType | null>(null);

export const DashboardProvider = ({ children }: { children: ReactNode }) => {
  const [data, setData] = useState<TrademarkData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('actions');
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);
  const [selectedTrademark, setSelectedTrademark] = useState<Trademark | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [focusedMark, setFocusedMark] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Trademark | 'new' | null>(null);
  const [breeOpen, setBreeOpen] = useState(false);
  const [hitPanelOpen, setHitPanelOpen] = useState(false);

  // Arriving from a Slack link with ?q=<text>: apply that search immediately,
  // so the dashboard lands filtered rather than showing the whole portfolio
  // first. Read in an effect rather than in the initial state because the
  // server prerender has no URL, and initialising from `window` there would be
  // a hydration mismatch. SearchBar reads the same param for its input value.
  useEffect(() => {
    const q = searchQueryFromUrl(window.location.search);
    if (q) setSearchQuery(q);
  }, []);

  const filteredTrademarks = useMemo(
    () => data?.trademarks.filter(t => matchesSearch(t, searchQuery)) ?? [],
    [data, searchQuery]
  );

  return (
    <DashboardContext.Provider value={{
      data, setData, searchQuery, setSearchQuery,
      hitPanelOpen, setHitPanelOpen,
      sidePanelOpen: hitPanelOpen || selectedTrademark !== null,
      activeTab, setActiveTab,
      pipelineFilter, setPipelineFilter,
      selectedTrademark, setSelectedTrademark,
      showReport, setShowReport,
      editTarget, setEditTarget,
      filteredTrademarks,
      focusedMark, setFocusedMark,
      breeOpen, setBreeOpen,
    }}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider');
  return ctx;
};
