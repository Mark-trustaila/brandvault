/**
 * Phase 4 Step 3 — process pending InboundEmails: classify, match to a
 * trademark by reference number (company-scoped), route by confidence tier, run
 * HIGH-confidence auto-actions, and alert via Bree. Every automatic action is
 * written to the AuditLog with actor="Bree". Nothing is silent; nothing that
 * isn't HIGH-confidence auto-acts.
 */
import type { InboundEmailStatus, Prisma } from '@prisma/client';
import { prisma } from './db';
import { classifyEmail } from './email-classifier';
import { AUTO_ACT_TYPES, type Classification, type CommunicationType } from './email-types';
import { writeAudit } from './audit';
import { sendBree } from './alerts';
import { autoActEnabled } from './email-config';
import { proposeApproval, doRegister } from './approvals';
import * as bree from './bree-messages';
import { anchorWatchNotice, daysToOpposition } from './watch-notices';
import { watchNoticeLink } from './notifications';
import { waitUntil } from '@vercel/functions';
import { emitWatchNotice } from './ailaCore';

const ALERT_ONLY: CommunicationType[] = [
  'examination_report',
  'opposition_notice',
  'opposition_procedural',
  'watch_notice',
  'cancellation_notice',
  'euipo_login_notification',
];
const HIGH_URGENCY: CommunicationType[] = ['examination_report', 'opposition_notice', 'opposition_procedural', 'cancellation_notice'];

export type ProcessResult = {
  id: string;
  status: InboundEmailStatus;
  type?: CommunicationType;
  confidence?: string;
  matchedTrademarkId: string | null;
  actions: string[];
  alerts: string[];
  error?: string;
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Reduce a reference number to a comparable numeric core: drop a country/type
// prefix and leading zeros so "UK00003205169", "00003205169" and "3205169" all
// match, and "018123456" matches "18123456".
export function refCore(s: string): string {
  const up = (s || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
  return up.replace(/^(UK|GB|IR|EM|WO|EU)/, '').replace(/^0+/, '');
}

export async function matchTrademark(companyId: string, refs: string[]) {
  const cores = new Set(refs.map(refCore).filter((c) => c.length >= 5));
  if (!cores.size) return null;
  const marks = await prisma.trademark.findMany({
    where: { companyId },
    select: { id: true, markText: true, registryName: true, status: true, applicationNumber: true, registrationNumber: true, filingDate: true, registrationDate: true, expiryDate: true },
  });
  for (const m of marks) {
    for (const cand of [m.applicationNumber, m.registrationNumber]) {
      if (cand && cores.has(refCore(cand))) return m;
    }
  }
  return null;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

// Parse the loose date strings the classifier extracts ("05 January 2027",
// "2027-01-05", "January 5, 2027", "05/01/2027"). UTC, day-granularity.
export function parseLooseDate(s: string): Date | null {
  if (!s) return null;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
  const dMonthY = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dMonthY && MONTHS[dMonthY[2].toLowerCase()] !== undefined) return new Date(Date.UTC(+dMonthY[3], MONTHS[dMonthY[2].toLowerCase()], +dMonthY[1]));
  const monthDY = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthDY && MONTHS[monthDY[1].toLowerCase()] !== undefined) return new Date(Date.UTC(+monthDY[3], MONTHS[monthDY[1].toLowerCase()], +monthDY[2]));
  const slash = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) return new Date(Date.UTC(+slash[3], +slash[2] - 1, +slash[1]));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function firstMentionedDate(c: Classification): string | null {
  for (const d of c.deadlinesMentioned ?? []) {
    const parsed = parseLooseDate(d.date);
    if (parsed) return isoDay(parsed);
  }
  return null;
}

/** Process one pending InboundEmail. Idempotent: only acts on `pending` rows. */
export async function processInboundEmail(id: string, now = new Date()): Promise<ProcessResult> {
  const email = await prisma.inboundEmail.findUnique({ where: { id }, include: { attachments: true } });
  if (!email) return { id, status: 'pending', matchedTrademarkId: null, actions: [], alerts: [], error: 'not found' };
  if (email.status !== 'pending') {
    return { id, status: email.status, matchedTrademarkId: email.matchedTrademarkId, actions: [], alerts: [], error: 'already processed' };
  }

  const companyId = email.companyId;
  const actions: string[] = [];
  const alerts: string[] = [];
  const alert = async (msg: { text: string; blocks: unknown[] }) => {
    await sendBree(companyId, msg);
    alerts.push(msg.text);
  };
  const audit = (action: string, entityType: string, entityId: string, detail: Prisma.InputJsonValue) =>
    writeAudit({ companyId, userId: null, isPlatformAdmin: false, actor: 'Bree', action, entityType, entityId, detail });

  // 1. Classify.
  let c: Classification;
  try {
    c = await classifyEmail({
      subject: email.subject,
      bodyText: email.bodyText,
      attachmentTexts: email.attachments.map((a) => a.extractedText ?? '').filter(Boolean),
      fromAddress: email.fromAddress,
    });
  } catch (e) {
    return { id, status: 'pending', matchedTrademarkId: null, actions, alerts, error: 'classify failed: ' + (e as Error).message };
  }

  // 2. Match to a trademark (company-scoped, by reference number).
  const mark = await matchTrademark(companyId, c.referenceNumbers);
  let matchedTrademarkId = mark?.id ?? null;

  // 3. Route.
  let status: InboundEmailStatus = 'needs_review';
  const isHighAutoType = AUTO_ACT_TYPES.includes(c.communicationType) && c.confidence === 'high';

  if (isHighAutoType && mark) {
    if (c.communicationType === 'renewal_reminder') {
      // Read-only reconciliation — no mark data changes, so it stays automatic.
      status = 'processed';
      const our = await prisma.deadline.findFirst({ where: { trademarkId: mark.id, type: 'Renewal', completedAt: null }, orderBy: { dueDate: 'asc' } });
      const ourDate = our ? isoDay(our.dueDate) : null;
      const theirDate = firstMentionedDate(c);
      if (ourDate && theirDate && ourDate === theirDate) {
        actions.push(`renewal reconciled: MATCH (${ourDate})`);
        await audit('bree.email.renewal_reconciled', 'Trademark', mark.id, { inboundEmailId: id, result: 'match', date: ourDate });
        await alert(bree.renewalReconcileMatch({ markText: mark.markText, registry: mark.registryName, dueDate: ourDate }));
      } else {
        actions.push(`renewal reconciled: MISMATCH (ours ${ourDate} vs registry ${theirDate})`);
        await audit('bree.email.renewal_mismatch', 'Trademark', mark.id, { inboundEmailId: id, ourDate, theirDate });
        await alert(bree.renewalReconcileMismatch({ markText: mark.markText, registry: mark.registryName, ourDate, theirDate }));
      }
    } else if (c.communicationType === 'registration_certificate' && autoActEnabled('registration_certificate')) {
      // Promoted to auto-act via AUTO_ACT_REGISTRATION — writes directly.
      status = 'processed';
      const r = await doRegister(mark);
      actions.push(`status ${r.from}→Registered; deadlines recalculated (${r.persisted}) [auto]`);
      await audit('bree.email.registered', 'Trademark', mark.id, { inboundEmailId: id, from: r.from, to: 'Registered', refs: c.referenceNumbers, mode: 'auto' });
      await alert(bree.emailRegistered({ markText: mark.markText, registry: mark.registryName, renewalDate: r.renewalDate ?? undefined }));
    } else if (c.communicationType === 'registration_certificate') {
      // Default: propose the registration for human approval.
      status = 'awaiting_approval';
      const ap = await proposeApproval({
        companyId, inboundEmailId: id, trademarkId: mark.id, actionType: 'registration_certificate',
        summary: `Mark ${mark.markText} (${mark.registryName}) → Registered`,
        payload: { kind: 'registration_certificate', fromStatus: mark.status as string, refs: c.referenceNumbers },
      });
      actions.push(`proposed registration for approval (${ap.id})`);
      await alert(bree.emailApprovalRequest({
        approvalId: ap.id, action: 'registration_certificate', markText: mark.markText, registry: mark.registryName,
        detail: `Bree proposes marking this *Registered* (currently *${mark.status}*) and recalculating its renewal deadlines, based on a registry certificate.`,
      }));
    } else if (c.communicationType === 'renewal_confirmation') {
      // NEVER auto — completing a renewal deadline silences a live obligation.
      const our = await prisma.deadline.findFirst({ where: { trademarkId: mark.id, type: 'Renewal', completedAt: null }, orderBy: { dueDate: 'asc' } });
      if (our) {
        status = 'awaiting_approval';
        const ap = await proposeApproval({
          companyId, inboundEmailId: id, trademarkId: mark.id, actionType: 'renewal_confirmation',
          summary: `Complete renewal deadline ${isoDay(our.dueDate)} for ${mark.markText} (${mark.registryName})`,
          payload: { kind: 'renewal_confirmation', deadlineId: our.id, dueDate: isoDay(our.dueDate) },
        });
        actions.push(`proposed renewal completion for approval (${ap.id})`);
        await alert(bree.emailApprovalRequest({
          approvalId: ap.id, action: 'renewal_confirmation', markText: mark.markText, registry: mark.registryName,
          detail: `A registry confirmation reports the renewal (due *${isoDay(our.dueDate)}*) is processed. Approve to mark that deadline complete.`,
        }));
      } else {
        // Nothing open to complete — don't propose a no-op; flag for review.
        status = 'needs_review';
        actions.push('renewal confirmation received but no open renewal deadline found');
        await audit('bree.email.review', 'InboundEmail', id, { type: c.communicationType, note: 'no open renewal deadline' });
        await alert(bree.emailAlert({ type: 'other', urgency: 'normal', markText: mark.markText, registry: mark.registryName, summary: c.summary }));
      }
    }
  } else if (c.communicationType === 'watch_notice') {
    // Third-party filing notice. ALERT ONLY: a WatchNotice row is created and
    // Bree posts a comparison link, but no mark data is touched and nothing is
    // proposed for approval. The anchor is the cited application number only.
    const portfolio = await prisma.trademark.findMany({
      where: { companyId },
      select: { id: true, applicationNumber: true, markText: true, registryName: true },
    });
    const anchor = anchorWatchNotice(c.watchNotice, portfolio);

    for (const a of anchor.anchored) {
      const ours = portfolio.find((p) => p.id === a.trademarkId)!;
      // Upsert on (trademarkId, thirdPartyApplicationNumber): re-processing the
      // same letter, or a duplicate forward, updates rather than duplicates.
      const wn = await prisma.watchNotice.upsert({
        where: {
          trademarkId_thirdPartyApplicationNumber: {
            trademarkId: a.trademarkId,
            thirdPartyApplicationNumber: a.thirdPartyApplicationNumber,
          },
        },
        create: {
          companyId,
          trademarkId: a.trademarkId,
          thirdPartyMarkText: a.thirdPartyMarkText,
          thirdPartyApplicationNumber: a.thirdPartyApplicationNumber,
          thirdPartyClasses: a.thirdPartyClasses,
          filingDate: a.filingDate,
          oppositionDeadline: a.oppositionDeadline,
          sourceEmailId: id,
        },
        update: {
          thirdPartyMarkText: a.thirdPartyMarkText,
          thirdPartyClasses: a.thirdPartyClasses,
          filingDate: a.filingDate,
          oppositionDeadline: a.oppositionDeadline,
          sourceEmailId: id,
        },
      });

      actions.push(`watch notice ${wn.id} anchored to ${ours.markText} (${ours.applicationNumber})`);
      await audit('bree.email.watch_notice', 'Trademark', a.trademarkId, {
        inboundEmailId: id,
        watchNoticeId: wn.id,
        thirdParty: a.thirdPartyApplicationNumber,
        classes: a.thirdPartyClasses,
      });
      await alert(
        bree.watchNoticeAlert({
          thirdPartyMarkText: a.thirdPartyMarkText,
          thirdPartyApplicationNumber: a.thirdPartyApplicationNumber,
          registry: c.registry === 'unknown' ? ours.registryName : c.registry,
          classes: a.thirdPartyClasses,
          ourMarkText: ours.markText,
          ourApplicationNumber: ours.applicationNumber ?? 'no number',
          oppositionDeadline: a.oppositionDeadline ? isoDay(a.oppositionDeadline) : null,
          daysToOpposition: daysToOpposition(a.oppositionDeadline, now),
          appLink: watchNoticeLink(wn.id),
        })
      );

      // AiLA Core: the notice as recorded. States what was filed and which
      // right it cites — no similarity, no urgency, no recommended action, so
      // no importance is sent. Dispatched via waitUntil (see lib/alerts.ts):
      // this path also runs inside the daily cron, so a Core outage must not
      // spend its budget.
      waitUntil(emitWatchNotice({
        companyId,
        markRef: ours.applicationNumber ?? ours.id,
        noticeRef: wn.id,
        noticeSummary: `Third-party filing ${a.thirdPartyMarkText} (${a.thirdPartyApplicationNumber})${
          a.thirdPartyClasses.length
            ? ` in class${a.thirdPartyClasses.length === 1 ? '' : 'es'} ${a.thirdPartyClasses.join(', ')}`
            : ''
        } cites ${a.citedReference}`,
        deepLink: watchNoticeLink(wn.id),
      }));
    }

    if (anchor.anchored.length > 0) {
      status = 'needs_review';
      matchedTrademarkId = anchor.anchored[0].trademarkId;
    } else {
      // No cited right resolves: alert-only to the inbox, never a guessed match.
      status = 'unmatched';
      const note = anchor.unmatchedReferences.length
        ? `no matching right for cited ${anchor.unmatchedReferences.join(', ')}`
        : `no matching right (${anchor.skippedReason ?? 'nothing cited'})`;
      actions.push(`watch notice: ${note}`);
      await audit('bree.email.watch_notice_unmatched', 'InboundEmail', id, {
        citedRefs: anchor.unmatchedReferences,
        reason: anchor.skippedReason,
      });
      await alert(
        bree.emailAlert({
          type: 'watch_notice',
          urgency: 'normal',
          summary: `${c.summary} (${note})`,
        })
      );
    }
  } else if (ALERT_ONLY.includes(c.communicationType)) {
    status = mark ? 'needs_review' : 'unmatched';
    const urgency = HIGH_URGENCY.includes(c.communicationType) ? 'high' : 'normal';
    const deadline = firstMentionedDate(c) ?? undefined;
    actions.push(`alert-only ${c.communicationType} (${mark ? 'matched' : 'unmatched'}) → ${status}`);
    await audit('bree.email.flagged', mark ? 'Trademark' : 'InboundEmail', mark ? mark.id : id, { inboundEmailId: id, type: c.communicationType, deadline, matched: Boolean(mark) });
    await alert(bree.emailAlert({ type: c.communicationType, urgency, markText: mark?.markText, registry: mark?.registryName, deadline, summary: c.summary }));
  } else if (!mark && c.referenceNumbers.length) {
    // Recognisable reference (incl. a HIGH-confidence auto-act type) but the mark
    // isn't in the portfolio — a feature, not an error.
    status = 'unmatched';
    actions.push(`unmatched: refs ${c.referenceNumbers.join(', ')} not in portfolio`);
    await audit('bree.email.unmatched', 'InboundEmail', id, { refs: c.referenceNumbers, type: c.communicationType });
    await alert(bree.unmatchedNotice({ subject: email.subject, refs: c.referenceNumbers, summary: c.summary }));
  } else {
    // ambiguous / other, or an auto-act type below HIGH confidence → quiet queue.
    status = 'needs_review';
    actions.push(`queued for review (${c.communicationType}, ${c.confidence})`);
    await audit('bree.email.review', 'InboundEmail', id, { type: c.communicationType, confidence: c.confidence });
  }

  // 4. Persist the classification + outcome on the InboundEmail.
  await prisma.inboundEmail.update({
    where: { id },
    data: { status, classificationJson: c as unknown as Prisma.InputJsonValue, matchedTrademarkId, processedAt: now },
  });

  return { id, status, type: c.communicationType, confidence: c.confidence, matchedTrademarkId, actions, alerts };
}

/** Process all pending InboundEmails (optionally scoped to a company). */
export async function processPending(opts: { companyId?: string; limit?: number } = {}): Promise<ProcessResult[]> {
  const pending = await prisma.inboundEmail.findMany({
    where: { status: 'pending', ...(opts.companyId ? { companyId: opts.companyId } : {}) },
    orderBy: { receivedAt: 'asc' },
    take: opts.limit ?? 200,
    select: { id: true },
  });
  const results: ProcessResult[] = [];
  for (const p of pending) results.push(await processInboundEmail(p.id));
  return results;
}
