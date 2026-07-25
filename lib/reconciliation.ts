/**
 * Renewal reconciliation — registry expiry date vs calculated renewal date.
 *
 * The obligation engine derives renewals from the filing (or registration) date
 * on a fixed term grid. The registry also states an expiry date. For most marks
 * these agree. Where they do not, the engine's grid is not evidence that the
 * registry is wrong: an old mark whose term ran from a different base, a late
 * renewal, or a conversion can all put the true expiry off the grid.
 *
 * INVARIANT: disagreements are surfaced, never silently resolved. The earlier
 * FUTURE date governs alerts and calculations. A live registry status overrides
 * a past calculated date, so no mark is ever shown overdue on a calculated date
 * alone. There are no age-based or vintage-based trust rules here, and none are
 * to be added: source agreement is the only signal this module recognises.
 *
 * Pure. No DB, no clock of its own: `now` is always passed in.
 */
import { getObligationsForTrademark } from './utils';

/** The frontend trademark shape this module needs. */
type TrademarkShape = { expiry_date?: string; status: string; registry_name: string };

/** Statuses that mean the right is still on the register. */
export const LIVE_STATUSES = new Set(['Registered', 'Published', 'Pending']);

export const isLiveStatus = (status: string): boolean => LIVE_STATUSES.has(status);

export type RenewalSource = 'registry' | 'calculated';

export type RenewalReconciliation = {
  /** Expiry date as stated by the registry. */
  registryExpiry: Date | null;
  /** Earliest future renewal date the obligation engine derives. */
  calculatedDue: Date | null;
  /** The date that governs alerts and countdowns. */
  governingDate: Date | null;
  governingSource: RenewalSource | null;
  /** True when both dates are present and fall on different days. */
  datesDiffer: boolean;
  /** True only when the governing date is past AND that is safe to assert. */
  overdue: boolean;
};

/** Same calendar day in UTC. Dates from the registry carry no meaningful time. */
export const sameDay = (a: Date, b: Date): boolean =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

export type ReconcileInput = {
  registryExpiry: Date | null;
  calculatedDue: Date | null;
  status: string;
  now: Date;
};

/**
 * Reconcile the two dates for a single mark.
 *
 * Governing date: the earlier of the two future dates. If only one is in the
 * future, it governs — this is the liveness guard in its usual form, where a
 * drifted calculated date has already passed but the registry shows the mark
 * live with a future expiry. If neither is in the future the registry date is
 * preferred as the more authoritative statement of fact.
 */
export function reconcileRenewal({
  registryExpiry,
  calculatedDue,
  status,
  now,
}: ReconcileInput): RenewalReconciliation {
  const live = isLiveStatus(status);
  const registryFuture = registryExpiry !== null && registryExpiry > now;
  const calculatedFuture = calculatedDue !== null && calculatedDue > now;

  const datesDiffer =
    registryExpiry !== null && calculatedDue !== null && !sameDay(registryExpiry, calculatedDue);

  let governingDate: Date | null = null;
  let governingSource: RenewalSource | null = null;

  if (registryFuture && calculatedFuture) {
    // Both ahead of us: the earlier one governs. A tie resolves to the registry,
    // which is the same date anyway.
    if (calculatedDue! < registryExpiry!) {
      governingDate = calculatedDue;
      governingSource = 'calculated';
    } else {
      governingDate = registryExpiry;
      governingSource = 'registry';
    }
  } else if (registryFuture) {
    governingDate = registryExpiry;
    governingSource = 'registry';
  } else if (calculatedFuture) {
    governingDate = calculatedDue;
    governingSource = 'calculated';
  } else if (registryExpiry !== null) {
    governingDate = registryExpiry;
    governingSource = 'registry';
  } else if (calculatedDue !== null) {
    governingDate = calculatedDue;
    governingSource = 'calculated';
  }

  // A past calculated date on a live mark is drift, not an expiry. Only a past
  // REGISTRY date (or a mark that is not live) can put a mark overdue.
  const governingIsPast = governingDate !== null && governingDate <= now;
  const overdue = governingIsPast && (governingSource === 'registry' || !live);

  return { registryExpiry, calculatedDue, governingDate, governingSource, datesDiffer, overdue };
}

/**
 * Read-time reconciliation for a mark in the frontend shape.
 *
 * Recomputes the calculated date from the engine rather than reading it off a
 * deadline row, so the display is correct before the persisted discrepancy
 * columns land (they are staged, not applied). Once those columns exist this
 * becomes a fallback for marks whose rows predate them.
 */
export function reconciliationForMark(trademark: TrademarkShape, now = new Date()): RenewalReconciliation {
  const registryExpiry = trademark.expiry_date ? new Date(trademark.expiry_date) : null;
  const calculatedDue =
    getObligationsForTrademark(trademark as never)
      .filter((o) => o.type === 'Renewal' && !o.uncertain && o.dueDate && (o.dueDate as Date) > now)
      .map((o) => o.dueDate as Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return reconcileRenewal({ registryExpiry, calculatedDue, status: trademark.status, now });
}

/**
 * Tooltip text for the discrepancy warning. Two sentences, no em dash, and it
 * states both dates rather than characterising either as wrong.
 */
export function discrepancyTooltip(r: RenewalReconciliation, fmt: (d: Date) => string): string {
  const registry = r.registryExpiry ? fmt(r.registryExpiry) : 'not stated';
  const calculated = r.calculatedDue ? fmt(r.calculatedDue) : 'not available';
  return `Registry expiry ${registry}. Calculated renewal ${calculated}. Dates differ: the earlier future date governs alerts.`;
}
