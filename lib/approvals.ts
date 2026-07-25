/**
 * Propose-and-approve gate for Bree's mark-mutating inbound actions.
 *
 * A HIGH-confidence renewal_confirmation or (unless promoted) registration_
 * certificate does NOT write directly. The processor calls `proposeApproval`,
 * which records the intended change and posts a Slack Approve/Reject message.
 * The mutation happens only when a human approves — `applyApproval` — and every
 * write is audited with both the proposer (Bree) and the approver.
 *
 * Idempotency: apply/reject flip `pending → decided` with a conditional
 * updateMany, so a double-click (or a retry) can only take effect once.
 *
 * The concrete DB mutations live in `doCompleteRenewal` / `doRegister` and are
 * shared with the processor's flag-on auto path so both routes behave identically.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { recalcDeadlines } from './deadlines';
import { writeAudit } from './audit';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type ApprovalPayload =
  | { kind: 'renewal_confirmation'; deadlineId: string; dueDate: string }
  | { kind: 'registration_certificate'; fromStatus: string; refs: string[] };

// ---- Concrete mutations (also called by the flag-on auto path) ----

/** Mark a renewal deadline complete. No-op (changed=false) if already complete or gone. */
export async function doCompleteRenewal(deadlineId: string, now: Date): Promise<{ dueDate: string | null; changed: boolean }> {
  const d = await prisma.deadline.findUnique({ where: { id: deadlineId } });
  if (!d || d.completedAt) return { dueDate: d ? isoDay(d.dueDate) : null, changed: false };
  await prisma.deadline.update({ where: { id: deadlineId }, data: { completedAt: now } });
  return { dueDate: isoDay(d.dueDate), changed: true };
}

type MarkForRegister = { id: string; status: string; registryName: string; filingDate: Date | null; registrationDate: Date | null; expiryDate: Date | null };

/** Set a mark Registered and recalculate its deadlines. Returns the prior status + next renewal. */
export async function doRegister(mark: MarkForRegister): Promise<{ from: string; persisted: number; renewalDate: string | null }> {
  const from = mark.status;
  await prisma.trademark.update({ where: { id: mark.id }, data: { status: 'Registered' } });
  // Recalc with the status we just wrote, not the one this object was read with:
  // the liveness guard in reconciliation depends on the mark being live.
  const r = await recalcDeadlines({ ...mark, status: 'Registered' });
  const renewal = await prisma.deadline.findFirst({ where: { trademarkId: mark.id, type: 'Renewal' }, orderBy: { dueDate: 'asc' } });
  return { from, persisted: r.persisted, renewalDate: renewal ? isoDay(renewal.dueDate) : null };
}

// ---- Propose / apply / reject ----

export type ProposeInput = {
  companyId: string;
  inboundEmailId: string;
  trademarkId: string;
  actionType: ApprovalPayload['kind'];
  summary: string;
  payload: ApprovalPayload;
};

/** Record a pending Approval + audit the proposal (actor Bree). Caller posts the Slack message. */
export async function proposeApproval(input: ProposeInput) {
  const approval = await prisma.approval.create({
    data: {
      companyId: input.companyId,
      inboundEmailId: input.inboundEmailId,
      trademarkId: input.trademarkId,
      actionType: input.actionType,
      summary: input.summary,
      payloadJson: input.payload as unknown as Prisma.InputJsonValue,
      status: 'pending',
      proposedBy: 'Bree',
    },
  });
  await writeAudit({
    companyId: input.companyId,
    userId: null,
    isPlatformAdmin: false,
    actor: 'Bree',
    action: 'bree.email.proposed',
    entityType: 'Approval',
    entityId: approval.id,
    detail: { inboundEmailId: input.inboundEmailId, trademarkId: input.trademarkId, actionType: input.actionType, summary: input.summary },
  });
  return approval;
}

export type Decider = { slackUserId?: string; slackUserName?: string };
export type DecisionResult = {
  ok: boolean;
  status: 'approved' | 'rejected' | 'already_decided' | 'not_found';
  effect?: string;
  actionType?: string;
  mark?: { markText: string; registry: string } | null;
};

const deciderLabel = (d: Decider) => d.slackUserName ?? d.slackUserId ?? 'unknown';
const auditActor = (d: Decider) => `Slack:${deciderLabel(d)}`;

/** Apply an approved action. Optimistically locks pending→approved so it runs at most once. */
export async function applyApproval(approvalId: string, decider: Decider, now = new Date()): Promise<DecisionResult> {
  const locked = await prisma.approval.updateMany({
    where: { id: approvalId, status: 'pending' },
    data: { status: 'approved', decidedBySlackId: decider.slackUserId ?? null, decidedBySlackName: decider.slackUserName ?? null, decidedAt: now },
  });
  const approval = await prisma.approval.findUnique({ where: { id: approvalId }, include: { trademark: true } });
  if (!approval) return { ok: false, status: 'not_found' };
  const mark = approval.trademark ? { markText: approval.trademark.markText, registry: approval.trademark.registryName } : null;
  const base = { actionType: approval.actionType, mark };
  if (locked.count !== 1) return { ok: false, status: 'already_decided', ...base };

  const payload = approval.payloadJson as unknown as ApprovalPayload;
  let effect = '';

  if (payload.kind === 'renewal_confirmation') {
    const r = await doCompleteRenewal(payload.deadlineId, now);
    effect = r.changed ? `Renewal deadline ${r.dueDate} marked complete.` : `No open renewal deadline to complete${r.dueDate ? ` (${r.dueDate})` : ''}.`;
    await writeAudit({
      companyId: approval.companyId, userId: null, isPlatformAdmin: false, actor: auditActor(decider),
      action: 'bree.email.renewal_completed', entityType: 'Trademark', entityId: approval.trademarkId ?? approval.id,
      reason: 'Approved renewal confirmation',
      detail: { approvalId: approval.id, proposedBy: 'Bree', approvedBySlackId: decider.slackUserId ?? null, approvedBySlackName: decider.slackUserName ?? null, deadlineId: payload.deadlineId, changed: r.changed },
    });
  } else if (payload.kind === 'registration_certificate') {
    const m = approval.trademarkId ? await prisma.trademark.findUnique({ where: { id: approval.trademarkId } }) : null;
    if (m) {
      const r = await doRegister(m);
      effect = `Status ${r.from} → Registered; deadlines recalculated (${r.persisted}).` + (r.renewalDate ? ` Renewal ${r.renewalDate}.` : '');
      await writeAudit({
        companyId: approval.companyId, userId: null, isPlatformAdmin: false, actor: auditActor(decider),
        action: 'bree.email.registered', entityType: 'Trademark', entityId: m.id,
        reason: 'Approved registration certificate',
        detail: { approvalId: approval.id, proposedBy: 'Bree', approvedBySlackId: decider.slackUserId ?? null, approvedBySlackName: decider.slackUserName ?? null, from: r.from, to: 'Registered' },
      });
    } else {
      effect = 'The mark no longer exists — no change made.';
    }
  }

  if (approval.inboundEmailId) {
    await prisma.inboundEmail.update({ where: { id: approval.inboundEmailId }, data: { status: 'processed', processedAt: now } }).catch(() => {});
  }
  return { ok: true, status: 'approved', effect, ...base };
}

/** Reject an approval — no mutation; leaves the email for manual review. Idempotent. */
export async function rejectApproval(approvalId: string, decider: Decider, now = new Date()): Promise<DecisionResult> {
  const locked = await prisma.approval.updateMany({
    where: { id: approvalId, status: 'pending' },
    data: { status: 'rejected', decidedBySlackId: decider.slackUserId ?? null, decidedBySlackName: decider.slackUserName ?? null, decidedAt: now },
  });
  const approval = await prisma.approval.findUnique({ where: { id: approvalId }, include: { trademark: true } });
  if (!approval) return { ok: false, status: 'not_found' };
  const mark = approval.trademark ? { markText: approval.trademark.markText, registry: approval.trademark.registryName } : null;
  const base = { actionType: approval.actionType, mark };
  if (locked.count !== 1) return { ok: false, status: 'already_decided', ...base };

  await writeAudit({
    companyId: approval.companyId, userId: null, isPlatformAdmin: false, actor: auditActor(decider),
    action: 'bree.email.proposal_rejected', entityType: 'Approval', entityId: approval.id,
    detail: { approvalId: approval.id, proposedBy: 'Bree', rejectedBySlackId: decider.slackUserId ?? null, rejectedBySlackName: decider.slackUserName ?? null, actionType: approval.actionType },
  });
  if (approval.inboundEmailId) {
    await prisma.inboundEmail.update({ where: { id: approval.inboundEmailId }, data: { status: 'needs_review' } }).catch(() => {});
  }
  return { ok: true, status: 'rejected', effect: 'No change made. Left for manual review.', ...base };
}
