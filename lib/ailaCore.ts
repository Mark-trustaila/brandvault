// AiLA Core emitter for BrandVault. Drop into the BrandVault codebase (e.g.
// lib/ailaCore.ts). Server-side only: reads AILA_CORE_URL and
// AILA_CORE_APP_KEY from env (Sensitive). No dependencies beyond fetch.
//
// Design: fire-and-forget with bounded retry. Core is idempotent on
// (app, event_id), so retries are safe. A Core outage must never break a
// BrandVault operation — emit() never throws; it logs a failure and reports it
// in its return value (EmitResult) for callers that want to count outcomes.

import { randomUUID } from "node:crypto";

const APP = "brandvault";
const RETRIES = 3;
const BACKOFF_MS = [500, 2000, 8000];

interface Envelope {
  event_id: string;
  app: string;
  app_tenant_ref: string;
  type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

/**
 * What became of one emit. Returned rather than only logged, so a caller that
 * emits in bulk can report what actually landed.
 *
 * The absence of this is what let a backfill report `emitted: 25` while Core
 * rejected all 25 with `401 bad key` (2026-08-07): emit() returned void, so the
 * only record of the failure was a log line nobody was reading. Callers that do
 * not care still ignore the value and are unaffected.
 *
 *   delivered    — Core accepted it (202/200)
 *   rejected     — Core answered and refused: bad key (401) or bad payload/
 *                  unknown mapping (422). Terminal; no retry would help.
 *   dropped      — 5xx or network failure, retries exhausted. Worth re-running.
 *   unconfigured — no AILA_CORE_URL/APP_KEY. Not an error, but not delivered
 *                  either, and must never be counted as a send.
 */
export type EmitOutcome = 'delivered' | 'rejected' | 'dropped' | 'unconfigured';

export type EmitResult = {
  ok: boolean; // true only for 'delivered'
  outcome: EmitOutcome;
  eventId: string | null; // null when unconfigured — no envelope was minted
  status?: number; // the HTTP status, when Core answered
  error?: string; // Core's response body, truncated, when it refused
};

async function emit(
  appTenantRef: string,
  type: string,
  payload: Record<string, unknown>,
  occurredAt: Date = new Date()
): Promise<EmitResult> {
  const url = process.env.AILA_CORE_URL;
  const key = process.env.AILA_CORE_APP_KEY;
  // Emitter not configured; a no-op, not an error — but not a send either.
  if (!url || !key) return { ok: false, outcome: 'unconfigured', eventId: null };

  const body: Envelope = {
    event_id: randomUUID(),
    app: APP,
    app_tenant_ref: appTenantRef,
    type,
    occurred_at: occurredAt.toISOString(),
    payload,
  };

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(`${url}/v1/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-aila-app-key": key,
        },
        body: JSON.stringify(body),
      });
      if (res.status === 202 || res.status === 200) {
        return { ok: true, outcome: 'delivered', eventId: body.event_id, status: res.status };
      }
      if (res.status === 401 || res.status === 422) {
        // Terminal: bad key or unknown mapping/payload. Log for manual
        // replay if a mapping is created late; do not retry.
        const text = (await res.text()).slice(0, 200);
        console.error(`[ailaCore] event ${body.event_id} rejected ${res.status}: ${text}`);
        return {
          ok: false,
          outcome: 'rejected',
          eventId: body.event_id,
          status: res.status,
          error: text,
        };
      }
      // 5xx: fall through to retry
    } catch {
      // network error: fall through to retry
    }
    if (attempt < RETRIES) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }
  console.error(`[ailaCore] event ${body.event_id} (${type}) dropped after retries`);
  return { ok: false, outcome: 'dropped', eventId: body.event_id };
}

/**
 * The title a matter carries in AiLA.
 *
 * Core falls back to `<deadline_type>: <right_ref>` when an app sends no title
 * (aila-core src/events/handlers.ts), which reads as "Renewal: UK00001248483" —
 * a registry number and nothing a person recognises. The mark string is the only
 * part of a notice a reader can act on at a glance, so it belongs in the title.
 *
 * One composer for every path that titles a matter, so the daily sweep, the
 * backfill and a watch notice cannot describe the same portfolio in three
 * different formats. The reference is kept alongside the name rather than
 * replaced by it: mark text is not unique — a portfolio holds TOPSHOP many times
 * over across registries — so the number is what disambiguates two matters that
 * would otherwise read identically.
 */
export function matterTitle(kind: string, markText: string, ref: string): string {
  const name = markText.trim();
  // A device mark can have no verbal element; falling back to the ref alone
  // beats "Renewal:  (UK...)" with a hole where the name should be.
  return name ? `${kind}: ${name} (${ref})` : `${kind}: ${ref}`;
}

// -- typed helpers for the three v1 BrandVault events ------------------------

export function emitDeadlineApproaching(args: {
  companyId: string; // BrandVault company id = app_tenant_ref
  rightRef: string;
  deadlineType: string; // e.g. "Renewal due"
  dueDate: string; // YYYY-MM-DD
  daysRemaining: number;
  deepLink: string;
  title?: string; // compose with matterTitle(); Core falls back to type + ref
  importance?: number; // 1-5, mapped from BrandVault's own priority
}): Promise<EmitResult> {
  return emit(args.companyId, "deadline.approaching", {
    right_ref: args.rightRef,
    deadline_type: args.deadlineType,
    due_date: args.dueDate,
    days_remaining: args.daysRemaining,
    deep_link: args.deepLink,
    ...(args.title ? { title: args.title } : {}),
    ...(args.importance ? { importance: args.importance } : {}),
  });
}

export function emitWatchNotice(args: {
  companyId: string;
  markRef: string;
  noticeRef?: string; // distinguishes concurrent notices against one mark
  noticeSummary: string;
  deepLink: string;
  title?: string; // compose with matterTitle(); Core falls back to the summary
  importance?: number;
}): Promise<EmitResult> {
  return emit(args.companyId, "watch.notice", {
    mark_ref: args.markRef,
    ...(args.noticeRef ? { notice_ref: args.noticeRef } : {}),
    notice_summary: args.noticeSummary,
    deep_link: args.deepLink,
    ...(args.title ? { title: args.title } : {}),
    ...(args.importance ? { importance: args.importance } : {}),
  });
}

export function emitImportCompleted(args: {
  companyId: string;
  counts: Record<string, number>; // e.g. { marks: 120, classes: 340 }
  snapshotRef?: string;
}): Promise<EmitResult> {
  return emit(args.companyId, "import.completed", {
    counts: args.counts,
    ...(args.snapshotRef ? { snapshot_ref: args.snapshotRef } : {}),
  });
}
