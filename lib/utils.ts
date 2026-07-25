import type { Trademark, Obligation } from '../types/trademark';
import { getRegistryRule, addTerm, renewalTermYears, type BaseDate } from './renewal-rules';

export const BADGE_COLORS = ['#2e6b8a','#6940a5','#0f7b6c','#c4823f','#8b5e3c','#5a7d5a','#b85450','#4a6fa5'];
export const NICE_CLASS_COLORS = ['#2e6b8a','#6940a5','#0f7b6c','#c4823f','#8b5e3c'];

export const getInitials = (str: string): string =>
  str?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'NA';

export const calculateDaysRemaining = (expiryDate?: string): number => {
  if (!expiryDate) return 9999;
  const expiry = new Date(expiryDate);
  const today = new Date();
  return Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

// Renewal windows, shared so the StatsBar and the Intelligence panel cannot drift.
// Both count individual rights records, never distinct mark names.
export const RENEWAL_WINDOW_DAYS = 365;
export const RENEWAL_URGENT_DAYS = 60;

export const renewalsDueWithin = (trademarks: Trademark[], days: number): Trademark[] =>
  trademarks.filter(t => {
    const remaining = calculateDaysRemaining(t.expiry_date);
    return remaining > 0 && remaining <= days;
  });

export const formatDate = (dateStr?: string): string => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const getDaysBadgeStyle = (days: number): { bg: string; color: string; text: string } => {
  if (days <= 90) return { bg: 'rgba(235,87,87,0.08)', color: '#eb5757', text: `${days}d` };
  if (days <= 180) return { bg: '#f2994a', color: '#fff', text: `${days}d` };
  if (days <= 365) return { bg: 'rgba(15,123,108,0.08)', color: '#0f7b6c', text: `${days}d` };
  return { bg: '#f0efec', color: '#9b9a97', text: `${days}d` };
};

export const getStatusStyle = (status: string): { bg: string; color: string } => {
  const map: Record<string, { bg: string; color: string }> = {
    'Registered': { bg: 'rgba(15,123,108,0.08)', color: '#0f7b6c' },
    'Pending': { bg: 'rgba(242,153,74,0.08)', color: '#f2994a' },
    'Published': { bg: 'rgba(46,107,138,0.08)', color: '#2e6b8a' },
    'Expired': { bg: 'rgba(235,87,87,0.08)', color: '#eb5757' },
    'Abandoned': { bg: 'rgba(235,87,87,0.08)', color: '#eb5757' },
  };
  return map[status] || { bg: '#f0efec', color: '#9b9a97' };
};

export const matchesSearch = (trademark: Trademark, query: string): boolean => {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    (trademark.mark_text || '').toLowerCase().includes(q) ||
    (trademark.application_number || '').toLowerCase().includes(q) ||
    (trademark.registration_number || '').toLowerCase().includes(q) ||
    (trademark.registry_name || '').toLowerCase().includes(q) ||
    (trademark.status || '').toLowerCase().includes(q) ||
    (trademark.client_agent_name || '').toLowerCase().includes(q)
  );
};

// Config-driven obligations. The calculation (window / urgency / overdue /
// recurring) is unchanged from the original engine — only the data source and
// the base-date selection (filing vs registration, per registry) have moved
// into config/renewal-rules.json. See lib/renewal-rules.ts.
type Job = {
  type: string; base: BaseDate; dueYears: number;
  windowMonths: number; critical: boolean; recurringYears?: number; appliesAfter?: string;
};

export const getObligationsForTrademark = (trademark: Trademark): Obligation[] => {
  const rule = getRegistryRule(trademark.registry_name);
  if (!rule) return [];

  const filingDate = trademark.filing_date ? new Date(trademark.filing_date) : null;
  const regDate = trademark.registration_date ? new Date(trademark.registration_date) : null;
  const now = new Date();
  const obligations: Obligation[] = [];

  // Primary renewal (recurring), plus any special obligations from config.
  const jobs: Job[] = [
    {
      type: 'Renewal', base: rule.termFrom, dueYears: renewalTermYears(rule, regDate),
      windowMonths: rule.earlyWindowMonths, critical: true, recurringYears: renewalTermYears(rule, regDate),
    },
    ...(rule.obligations ?? []).map((o) => ({
      type: o.type, base: o.base, dueYears: o.dueYears,
      windowMonths: o.windowMonths ?? rule.earlyWindowMonths,
      critical: o.critical ?? true, recurringYears: o.recurringYears, appliesAfter: o.appliesAfter,
    })),
  ];

  for (const job of jobs) {
    const baseDate = job.base === 'registration' ? regDate : filingDate;
    if (!baseDate) {
      // Required date missing — flag rather than guess (never estimate one from the other).
      obligations.push({
        type: job.type, desc: `renewal date uncertain — ${job.base} date required`,
        dueDate: null, windowStart: null, daysUntil: null,
        critical: job.critical, actionable: false, overdue: false, inWindow: false, uncertain: true,
      });
      continue;
    }
    // Some obligations only apply to marks registered after a cutoff (e.g. Mexico post-Aug-2018).
    if (job.appliesAfter && regDate && regDate < new Date(job.appliesAfter)) continue;

    const maxYears = job.recurringYears ? 100 : job.dueYears;
    for (let yr = job.dueYears; yr <= maxYears; yr += job.recurringYears || maxYears + 1) {
      const dueDate = addTerm(baseDate, yr, rule.calendar);
      const windowStart = new Date(dueDate);
      windowStart.setUTCMonth(windowStart.getUTCMonth() - job.windowMonths);
      const daysUntil = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil < -365) continue;
      if (daysUntil > 365 * 15) break;
      obligations.push({
        type: job.type, desc: job.type, dueDate, windowStart, daysUntil,
        critical: job.critical,
        actionable: daysUntil <= 180 && daysUntil > 0,
        overdue: daysUntil < 0,
        inWindow: now >= windowStart && daysUntil > 0,
        uncertain: false,
      });
    }
  }

  // Uncertain (no daysUntil) sort last.
  return obligations.sort((a, b) => {
    if (a.daysUntil == null) return 1;
    if (b.daysUntil == null) return -1;
    return a.daysUntil - b.daysUntil;
  });
};
