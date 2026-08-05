// AiLA Core emitter for BrandVault. Drop into the BrandVault codebase (e.g.
// lib/ailaCore.ts). Server-side only: reads AILA_CORE_URL and
// AILA_CORE_APP_KEY from env (Sensitive). No dependencies beyond fetch.
//
// Design: fire-and-forget with bounded retry. Core is idempotent on
// (app, event_id), so retries are safe. A Core outage must never break a
// BrandVault operation — emit() swallows terminal failures after logging.

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

async function emit(
  appTenantRef: string,
  type: string,
  payload: Record<string, unknown>,
  occurredAt: Date = new Date()
): Promise<void> {
  const url = process.env.AILA_CORE_URL;
  const key = process.env.AILA_CORE_APP_KEY;
  if (!url || !key) return; // emitter not configured; a no-op, not an error

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
      if (res.status === 202 || res.status === 200) return;
      if (res.status === 401 || res.status === 422) {
        // Terminal: bad key or unknown mapping/payload. Log for manual
        // replay if a mapping is created late; do not retry.
        console.error(
          `[ailaCore] event ${body.event_id} rejected ${res.status}: ${await res.text()}`
        );
        return;
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
}

// -- typed helpers for the three v1 BrandVault events ------------------------

export function emitDeadlineApproaching(args: {
  companyId: string; // BrandVault company id = app_tenant_ref
  rightRef: string;
  deadlineType: string; // e.g. "Renewal due"
  dueDate: string; // YYYY-MM-DD
  daysRemaining: number;
  deepLink: string;
  importance?: number; // 1-5, mapped from BrandVault's own priority
}): Promise<void> {
  return emit(args.companyId, "deadline.approaching", {
    right_ref: args.rightRef,
    deadline_type: args.deadlineType,
    due_date: args.dueDate,
    days_remaining: args.daysRemaining,
    deep_link: args.deepLink,
    ...(args.importance ? { importance: args.importance } : {}),
  });
}

export function emitWatchNotice(args: {
  companyId: string;
  markRef: string;
  noticeRef?: string; // distinguishes concurrent notices against one mark
  noticeSummary: string;
  deepLink: string;
  importance?: number;
}): Promise<void> {
  return emit(args.companyId, "watch.notice", {
    mark_ref: args.markRef,
    ...(args.noticeRef ? { notice_ref: args.noticeRef } : {}),
    notice_summary: args.noticeSummary,
    deep_link: args.deepLink,
    ...(args.importance ? { importance: args.importance } : {}),
  });
}

export function emitImportCompleted(args: {
  companyId: string;
  counts: Record<string, number>; // e.g. { marks: 120, classes: 340 }
  snapshotRef?: string;
}): Promise<void> {
  return emit(args.companyId, "import.completed", {
    counts: args.counts,
    ...(args.snapshotRef ? { snapshot_ref: args.snapshotRef } : {}),
  });
}
