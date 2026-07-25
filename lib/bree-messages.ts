/**
 * Bree's Slack messages — pure Block Kit formatters (no I/O, fully testable).
 * The assistant is Bree; every message is signed "Bree · BrandVault".
 * Tone: enterprise. Plain, no decorative emoji; structural headers only.
 */
type Block = Record<string, unknown>;
export type BreeMessage = { text: string; blocks: Block[] };

const section = (text: string): Block => ({ type: 'section', text: { type: 'mrkdwn', text } });
const header = (text: string): Block => ({ type: 'header', text: { type: 'plain_text', text, emoji: false } });
const context = (appLink?: string): Block => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text: appLink ? `<${appLink}|See in app →>  ·  Bree · BrandVault` : 'Bree · BrandVault' }],
});

// appLink (when given) adds a single "See in app →" deep link to the footer.
const withBree = (text: string, blocks: Block[], appLink?: string): BreeMessage => ({ text, blocks: [...blocks, context(appLink)] });

// ---- Outbound alerts ----

export function renewalAlert(o: { markText: string; registry: string; type: string; dueDate: string; daysRemaining: number; appLink?: string }): BreeMessage {
  return withBree(
    `${o.type} for ${o.markText} (${o.registry}) due in ${o.daysRemaining} days. Due ${o.dueDate}`,
    [
      header('Renewal approaching'),
      section(`*${o.markText}* · ${o.registry}\n${o.type} due *${o.dueDate}*. *${o.daysRemaining} days* remaining`),
    ],
    o.appLink
  );
}

export function statusChange(o: { markText: string; registry: string; from: string; to: string; appLink?: string }): BreeMessage {
  return withBree(
    `${o.markText} (${o.registry}) status: ${o.from} → ${o.to}`,
    [section(`*${o.markText}* · ${o.registry}\nStatus changed: *${o.from}* → *${o.to}*`)],
    o.appLink
  );
}

export function weeklyDigest(o: {
  companyName: string;
  upcoming: { markText: string; registry: string; type: string; dueDate: string; daysRemaining: number }[];
  appLink?: string;
}): BreeMessage {
  const lines = o.upcoming.length
    ? o.upcoming.map((u) => `• *${u.markText}* (${u.registry}): ${u.type} in ${u.daysRemaining}d · ${u.dueDate}`).join('\n')
    : '_Nothing due soon._';
  return withBree(
    `Weekly digest for ${o.companyName}: ${o.upcoming.length} upcoming`,
    [
      header(`Weekly digest: ${o.companyName}`),
      section(o.upcoming.length ? `*${o.upcoming.length}* upcoming deadline${o.upcoming.length === 1 ? '' : 's'}:` : 'Nothing due soon.'),
      section(lines),
    ],
    o.appLink
  );
}

// ---- Slash-command responses ----

export function portfolioSummary(o: { companyName: string; total: number; registered: number; pending: number; published: number; needsAttention: number }): BreeMessage {
  return withBree(`${o.companyName}: ${o.total} marks`, [
    header(o.companyName),
    section(
      `*${o.total}* marks · *${o.registered}* registered · *${o.pending + o.published}* in prosecution\n` +
        `*${o.needsAttention}* need attention (renewal within 12 months)`
    ),
  ]);
}

export function renewalsList(o: { items: { markText: string; registry: string; dueDate: string; daysRemaining: number }[] }): BreeMessage {
  if (o.items.length === 0) return withBree('No upcoming renewals', [section('No renewals coming up.')]);
  const lines = o.items.map((i) => `• *${i.markText}* (${i.registry}): *${i.daysRemaining}d* · ${i.dueDate}`).join('\n');
  return withBree(`${o.items.length} upcoming renewals`, [header('Next renewals'), section(lines)]);
}

type StatusRow = { registry: string; status: string; nextDeadline?: { type: string; dueDate: string; daysRemaining: number } };
type StatusGroup = { markText: string; rows: StatusRow[] };

export function markStatusMsg(o: { query: string; groups: StatusGroup[] }): BreeMessage {
  const blocks: Block[] = [];
  for (const g of o.groups) {
    const lines = g.rows
      .map((r) => {
        const d = r.nextDeadline
          ? `next ${r.nextDeadline.type} *${r.nextDeadline.dueDate}* (${r.nextDeadline.daysRemaining}d)`
          : 'no upcoming deadline';
        return `• *${r.registry}*: ${r.status} · ${d}`;
      })
      .join('\n');
    blocks.push(section(`*${g.markText}*\n${lines}`));
  }
  const regs = o.groups.reduce((n, g) => n + g.rows.length, 0);
  const names = o.groups.length;
  const summary = names === 1 ? `${o.groups[0].markText}: ${regs} registration${regs === 1 ? '' : 's'}` : `${regs} registrations across ${names} marks`;
  return withBree(summary, [header('Mark status'), ...blocks]);
}

// ---- Inbound-email-driven alerts (Phase 4 Step 3) ----

// Human labels for alert-only communication types.
const TYPE_LABEL: Record<string, string> = {
  examination_report: 'Examination report',
  opposition_notice: 'Opposition filed against your mark',
  opposition_procedural: 'Opposition/tribunal update',
  watch_notice: 'Third-party filing notice',
  cancellation_notice: 'Cancellation reported',
  euipo_login_notification: 'EUIPO communication. Retrieve from User Area',
  ambiguous: 'Correspondence',
  other: 'Registry correspondence',
};

const markLine = (markText?: string, registry?: string) =>
  markText ? `*${markText}*${registry ? ` · ${registry}` : ''}` : '_mark not in your portfolio_';

/**
 * watch_notice → a third party has applied for a mark the registry flagged
 * against one of ours. Alert only: nothing is mutated, nothing is proposed.
 *
 * Both application numbers are in the text. Two ASOS marks can share a due date
 * and a mark name, so the number is what makes the right identifiable in the
 * alert itself. No em dashes.
 */
export function watchNoticeAlert(o: {
  thirdPartyMarkText: string;
  thirdPartyApplicationNumber: string;
  registry: string;
  classes: number[];
  ourMarkText: string;
  ourApplicationNumber: string;
  oppositionDeadline?: string | null;
  daysToOpposition?: number | null;
  appLink?: string;
}): BreeMessage {
  const classList = o.classes.length ? `class${o.classes.length === 1 ? '' : 'es'} ${o.classes.join(', ')}` : 'classes not stated';
  const summary = `Third-party filing notice: ${o.thirdPartyMarkText} (${o.thirdPartyApplicationNumber}) applied for at ${o.registry}`;

  const lines = [
    `*${o.thirdPartyMarkText}* (${o.thirdPartyApplicationNumber}) applied for at ${o.registry}, ${classList}.`,
    `Potentially relevant to your *${o.ourMarkText}* (${o.ourApplicationNumber}).`,
  ];
  if (o.oppositionDeadline) {
    const countdown = typeof o.daysToOpposition === 'number' ? ` (${o.daysToOpposition} days)` : '';
    lines.push(`Opposition period ends *${o.oppositionDeadline}*${countdown}.`);
  }
  if (o.appLink) lines.push(`<${o.appLink}|See in app →>`);

  return withBree(summary, [header('Third-party filing notice'), section(lines.join('\n'))]);
}

// registration_certificate → mark set Registered + renewal deadline calculated.
export function emailRegistered(o: { markText: string; registry: string; renewalDate?: string }): BreeMessage {
  return withBree(`${o.markText} registered (${o.registry})`, [
    header('Registration confirmed'),
    section(
      `${markLine(o.markText, o.registry)} is now *Registered* per a registry certificate.` +
        (o.renewalDate ? `\nRenewal deadline set: *${o.renewalDate}*.` : '\n_No renewal date could be calculated (needs data)._')
    ),
  ]);
}

// renewal_reminder reconciliation — registry date agrees with ours.
export function renewalReconcileMatch(o: { markText: string; registry: string; dueDate: string }): BreeMessage {
  return withBree(`${o.markText}: renewal date confirmed by registry (${o.dueDate})`, [
    section(`${markLine(o.markText, o.registry)}\nRegistry renewal reminder *matches* our deadline: *${o.dueDate}*. No action needed.`),
  ]);
}

// renewal_reminder reconciliation — MISMATCH (data error or engine bug).
export function renewalReconcileMismatch(o: { markText: string; registry: string; ourDate: string | null; theirDate: string | null }): BreeMessage {
  return withBree(`${o.markText}: renewal date MISMATCH (registry ${o.theirDate ?? '?'} vs ours ${o.ourDate ?? '?'})`, [
    header('Renewal date mismatch. Please review'),
    section(
      `${markLine(o.markText, o.registry)}\nRegistry says renewal is due *${o.theirDate ?? 'unknown'}*, but our deadline is *${o.ourDate ?? 'none calculated'}*.` +
        `\nThis is either a portfolio-data error or a deadline-engine issue. Both are worth checking.`
    ),
  ]);
}

type ApprovalAction = 'renewal_confirmation' | 'registration_certificate';
const APPROVAL_HEADING: Record<ApprovalAction, string> = {
  renewal_confirmation: 'Approval needed: record renewal',
  registration_certificate: 'Approval needed: mark registered',
};

// A mark-mutating action Bree wants to take, proposed for human approval.
// The Approve/Reject buttons carry the approval id; nothing changes until a
// human clicks Approve (handled by /api/slack/interactivity).
export function emailApprovalRequest(o: {
  approvalId: string;
  action: ApprovalAction;
  markText: string;
  registry: string;
  detail: string;
}): BreeMessage {
  const heading = APPROVAL_HEADING[o.action];
  return withBree(`${heading}: ${o.markText} (${o.registry})`, [
    header(heading),
    section(`${markLine(o.markText, o.registry)}\n${o.detail}\n\n_No data has changed yet. Bree will make this change only if you approve._`),
    {
      type: 'actions',
      block_id: `approval:${o.approvalId}`,
      elements: [
        { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Approve', emoji: false }, action_id: 'approval_approve', value: o.approvalId },
        { type: 'button', style: 'danger', text: { type: 'plain_text', text: 'Reject', emoji: false }, action_id: 'approval_reject', value: o.approvalId },
      ],
    },
  ]);
}

// The message swapped in (via response_url) once an approval is decided, so the
// buttons can't be clicked again and the outcome is on the record.
export function emailApprovalResolved(o: {
  decision: 'approved' | 'rejected';
  action: ApprovalAction;
  markText: string;
  registry: string;
  by: string;
  effect: string;
}): BreeMessage {
  const verb = o.decision === 'approved' ? 'Approved' : 'Rejected';
  return withBree(`${verb} by ${o.by}: ${o.markText} (${o.registry})`, [
    header(APPROVAL_HEADING[o.action]),
    section(`${markLine(o.markText, o.registry)}\n*${verb}* by ${o.by}.\n${o.effect}`),
  ]);
}

// renewal_confirmation → deadline marked complete.
export function renewalCompleted(o: { markText: string; registry: string; dueDate?: string }): BreeMessage {
  return withBree(`${o.markText}: renewal recorded, deadline cleared`, [
    section(`${markLine(o.markText, o.registry)}\nRegistry confirmed the renewal was processed. The renewal deadline${o.dueDate ? ` (${o.dueDate})` : ''} is now complete.`),
  ]);
}

// Alert-only types → priority + deadline + human review.
export function emailAlert(o: {
  type: string;
  urgency: 'high' | 'normal';
  markText?: string;
  registry?: string;
  deadline?: string;
  summary?: string;
}): BreeMessage {
  const label = TYPE_LABEL[o.type] ?? 'Registry correspondence';
  const lines: string[] = [];
  if (o.urgency === 'high') lines.push('*Priority: High.*');
  lines.push(`${markLine(o.markText, o.registry)}: *${label}*`);
  if (o.deadline) lines.push(`Deadline: *${o.deadline}*`);
  if (o.type === 'cancellation_notice' && o.markText) lines.push(`_Status change reported. Please confirm. The record has NOT been changed._`);
  if (o.summary) lines.push(`_${o.summary}_`);
  return withBree(`${label}${o.markText ? `: ${o.markText}` : ''}`, [header(label), section(lines.join('\n'))]);
}

// A matched reference points at a mark not in the portfolio (feature, not error).
export function unmatchedNotice(o: { subject: string; refs: string[]; summary?: string }): BreeMessage {
  return withBree(`Correspondence about a mark not in your portfolio`, [
    header('Mark not in your portfolio'),
    section(
      `Bree found registry correspondence referencing ${o.refs.length ? `*${o.refs.join(', ')}*` : 'a mark'} that isn't in BrandVault yet.` +
        `\n_${o.subject}_` +
        (o.summary ? `\n${o.summary}` : '') +
        `\nAdd the mark to bring it under monitoring.`
    ),
  ]);
}

export function notFound(query: string): BreeMessage {
  return withBree(`No mark matching "${query}"`, [section(`No mark matching *${query}*.`)]);
}

export function help(): BreeMessage {
  return withBree('Bree commands', [
    header('Bree commands'),
    section(
      '`/bree portfolio` gives a portfolio summary\n' +
        '`/bree renewals` lists the next 5 upcoming renewals\n' +
        '`/bree status [mark]` gives a mark’s status and next deadline\n' +
        '`/bree help` shows this message'
    ),
  ]);
}
