/**
 * AiLA Core deadline backfill — emission only.
 *
 * A new AiLA customer's dashboard is fed by `deadline.approaching` events, and
 * the daily sweep only emits when a deadline crosses a threshold it has not
 * crossed before. So a company onboarded today shows an empty dashboard until
 * one of its deadlines happens to trip 180/90/30 days — potentially months of
 * nothing, on a portfolio that is in fact full of dated obligations. This
 * replays the next N upcoming deadlines per company so day one looks like the
 * portfolio actually looks.
 *
 * EMISSION ONLY. This module is deliberately free of the side effects the alert
 * path has, because it is a catch-up of notices, not a decision to notify:
 *
 *  - it never writes `Deadline.alert_*_sent`. Those flags are the sweep's dedupe
 *    memory. Setting them here would silence the real alert when the threshold
 *    is genuinely crossed; clearing or reading them would couple a replay to a
 *    delivery record. The backfill is invisible to them in both directions, so a
 *    company that has been backfilled still gets its real 180/90/30 alerts.
 *  - it never writes a `Notification` row, so it puts nothing in the Bree panel.
 *    Same reasoning as `?bree=1` in lib/deep-links.ts: a row per replayed
 *    deadline would fabricate 25 threads a customer was never alerted to.
 *  - it never posts to Slack. Nobody should get 25 Slack messages because they
 *    were onboarded.
 *
 * Because it writes no `Notification`, it has no notification link to deep-link
 * to, and mints none. It uses `dashboardSearchLink` — the same landing a
 * mark-specific Bree reply uses — so the notice opens the search-filtered
 * dashboard on that mark.
 *
 * RERUNS. Core upserts `deadline.approaching` onto a matter keyed by the
 * composed ref `<right_ref>:deadline:<deadline_type>`, so replaying a deadline
 * refreshes one envelope rather than stacking duplicates — running this twice on
 * a fresh tenant is a no-op the second time. It is NOT free on an established
 * tenant: Core treats a fresh occurrence as reason to reopen a `done` envelope,
 * so a blanket rerun can resurface matters someone has already closed in AiLA.
 * Target a company deliberately; the intended use is a tenant on day one.
 */
import { prisma } from './db';
import { emitDeadlineApproaching, type EmitOutcome } from './ailaCore';
import { alertBucket, alertImportance, daysUntil, normalizeThresholds } from './alerts';
import { dashboardSearchLink } from './deep-links';

/** Deadlines replayed per company when the caller names no limit. */
export const DEFAULT_BACKFILL_LIMIT = 25;

/** Upper bound on a caller-supplied limit — a backfill is a catch-up, not a dump. */
export const MAX_BACKFILL_LIMIT = 200;

/**
 * How many deadlines to replay: the caller's number, else `AILA_BACKFILL_LIMIT`
 * from the environment, else the default. Anything unusable (non-numeric, zero,
 * negative, fractional) falls through to the next source rather than failing —
 * a mistyped env var should not stop provisioning a customer.
 */
export function resolveBackfillLimit(requested?: unknown): number {
  for (const candidate of [requested, process.env.AILA_BACKFILL_LIMIT]) {
    const n = typeof candidate === 'string' ? Number(candidate) : candidate;
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) {
      return Math.min(n, MAX_BACKFILL_LIMIT);
    }
  }
  return DEFAULT_BACKFILL_LIMIT;
}

/** One notice the backfill would emit — the emitter's arguments, nothing more. */
export type BackfillNotice = {
  companyId: string;
  rightRef: string;
  deadlineType: string;
  dueDate: string;
  daysRemaining: number;
  deepLink: string;
  importance?: number;
};

/**
 * The notices a backfill of this company would emit, soonest first. Reads only.
 *
 * Selection mirrors the sweep's — future-dated deadlines for this company's
 * marks, soonest first — with one deliberate difference: completed deadlines are
 * excluded. `completedAt` is set when a renewal is confirmed satisfied, and
 * seeding a new dashboard with obligations already discharged would be wrong on
 * its face. (The daily sweep does not filter on it; see the PR notes.)
 */
export async function planBackfill(
  companyId: string,
  limit: number = DEFAULT_BACKFILL_LIMIT,
  now: Date = new Date()
): Promise<BackfillNotice[]> {
  const pref = await prisma.alertPreference.findUnique({ where: { companyId } });
  // A company with no preference row yet — the normal state on day one, before
  // Slack is connected — is read at the default thresholds.
  const thresholds = normalizeThresholds(pref?.thresholdDays);

  const deadlines = await prisma.deadline.findMany({
    where: { trademark: { companyId }, dueDate: { gte: now }, completedAt: null },
    include: { trademark: true },
    orderBy: { dueDate: 'asc' },
    take: limit,
  });

  return deadlines.map((d) => {
    const days = daysUntil(d.dueDate, now);
    return {
      companyId,
      // The same composed ref the sweep emits, so a replayed notice and a live
      // one address the same right in Core rather than two.
      rightRef: d.trademark.applicationNumber ?? d.trademark.id,
      deadlineType: d.type,
      dueDate: d.dueDate.toISOString().slice(0, 10),
      daysRemaining: days,
      deepLink: dashboardSearchLink(d.trademark.markText),
      importance: alertImportance(alertBucket(days, thresholds), thresholds.length),
    };
  });
}

/** One notice Core did not accept, with why — enough to act on without logs. */
export type BackfillFailure = {
  rightRef: string;
  outcome: EmitOutcome;
  eventId: string | null;
  status?: number;
  error?: string;
};

export type BackfillResult = {
  companyId: string;
  limit: number;
  planned: number;
  /** Notices Core ACCEPTED (202/200). Never a count of attempts — see below. */
  emitted: number;
  failed: number;
  failures: BackfillFailure[];
  dryRun: boolean;
  notices: BackfillNotice[];
};

/**
 * Replay this company's next upcoming deadlines to AiLA Core.
 *
 * Emits sequentially: the emitter retries with backoff on a Core 5xx, and firing
 * 25 of those chains concurrently at a struggling Core is how a backfill turns
 * into a thundering herd. `emitDeadlineApproaching` never throws, so one bad
 * notice cannot abandon the rest.
 *
 * `dryRun` returns exactly what would be sent without sending it — the intended
 * first call against any company, and the only form safe to run against an
 * environment sharing a database with production.
 */
export async function backfillCompany(args: {
  companyId: string;
  limit?: number;
  dryRun?: boolean;
  now?: Date;
}): Promise<BackfillResult> {
  const limit = resolveBackfillLimit(args.limit);
  const notices = await planBackfill(args.companyId, limit, args.now ?? new Date());
  const dryRun = args.dryRun === true;

  // Count what Core ACCEPTED, not what we attempted. Reporting attempts is how
  // a run that Core rejected 25 times for a bad app key came back as
  // `emitted: 25` and read as a success (2026-08-07). A caller must be able to
  // tell a delivered backfill from a rejected one without reading the logs.
  let emitted = 0;
  const failures: BackfillFailure[] = [];

  if (!dryRun) {
    for (const notice of notices) {
      const result = await emitDeadlineApproaching(notice);
      if (result.ok) {
        emitted++;
      } else {
        failures.push({
          rightRef: notice.rightRef,
          outcome: result.outcome,
          eventId: result.eventId,
          ...(result.status !== undefined ? { status: result.status } : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
        });
      }
    }
  }

  return {
    companyId: args.companyId,
    limit,
    planned: notices.length,
    emitted,
    failed: failures.length,
    failures,
    dryRun,
    notices,
  };
}
