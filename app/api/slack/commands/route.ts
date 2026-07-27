import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { prisma } from '../../../../lib/db';
import { APP_BASE_URL, slackConfig, verifySlackSignature } from '../../../../lib/slack';
import { parseBreeCommand, type BreeCommand } from '../../../../lib/bree-commands';
import * as bree from '../../../../lib/bree-messages';
import { answerBree, type BreeAnswer } from '../../../../lib/bree-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type BreeMsg = { text: string; blocks: unknown[] };

// Build the reply for a data-backed command (hits the DB). Never throws for the
// "workspace not connected" case; genuine errors bubble to the caller.
async function buildDataReply(teamId: string, cmd: BreeCommand): Promise<BreeMsg> {
  const pref = await prisma.alertPreference.findFirst({ where: { slackTeamId: teamId } });
  if (!pref) {
    return {
      text: 'This Slack workspace is not connected to a BrandVault company yet.',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: 'This workspace isn’t connected to a BrandVault company yet. An admin can connect it from *Settings → Alerts*.' } },
      ],
    };
  }
  return renderSlackAnswer(await answerBree(pref.companyId, cmd));
}

// Map a channel-agnostic BreeAnswer to Slack Block Kit. Preserves the exact
// prior output (same bree-messages formatters, same data) — no behaviour change.
function renderSlackAnswer(answer: BreeAnswer): BreeMsg {
  switch (answer.kind) {
    case 'portfolio':
      return bree.portfolioSummary({ ...answer, appLink: APP_BASE_URL });
    case 'renewals':
      return bree.renewalsList({ items: answer.items, appLink: APP_BASE_URL });
    case 'status':
      return answer.groups.length
        ? bree.markStatusMsg({ query: answer.query, groups: answer.groups, appLink: APP_BASE_URL })
        : bree.notFound(answer.query); // nothing found, so nothing to go and see
    case 'help':
      return bree.help();
  }
}

// Deliver the final answer to Slack's response_url, replacing the ack. Runs in
// the background (via waitUntil) so the HTTP response can return inside Slack's
// 3-second window even on a cold start. Best-effort — never throws.
async function deliverToSlack(responseUrl: string, build: () => Promise<BreeMsg>): Promise<void> {
  let payload: Record<string, unknown>;
  try {
    const msg = await build();
    payload = { response_type: 'ephemeral', replace_original: true, text: msg.text, blocks: msg.blocks };
  } catch {
    payload = { response_type: 'ephemeral', replace_original: true, text: 'Bree hit a snag handling that — please try again.' };
  }
  try {
    await fetch(responseUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch {
    /* best-effort delivery */
  }
}

const inline = (msg: BreeMsg) => NextResponse.json({ response_type: 'ephemeral', text: msg.text, blocks: msg.blocks });

// POST /api/slack/commands — handles `/bree ...`. Slack enforces a hard 3s
// response deadline; a cold serverless start (Prisma connecting to Azure) can
// exceed it, so DB-backed commands ACK immediately and deliver the real answer
// asynchronously via response_url. `/bree help` is static and answers inline.
export async function POST(req: Request) {
  const raw = await req.text();
  const cfg = slackConfig();
  if (cfg.signingSecret) {
    const ok = verifySlackSignature({
      signingSecret: cfg.signingSecret,
      timestamp: req.headers.get('x-slack-request-timestamp') ?? '',
      body: raw,
      signature: req.headers.get('x-slack-signature') ?? '',
    });
    if (!ok) return new NextResponse('bad signature', { status: 401 });
  }

  const form = new URLSearchParams(raw);
  const cmd = parseBreeCommand(form.get('text') ?? '');

  // Static, no DB → answer inline, no timeout risk.
  if (cmd.kind === 'help' || cmd.kind === 'unknown') return inline(bree.help());

  const teamId = form.get('team_id') ?? '';
  const responseUrl = form.get('response_url') ?? '';

  // Fallback if Slack didn't send a response_url (e.g. local testing): sync.
  if (!responseUrl) return inline(await buildDataReply(teamId, cmd));

  // Ack now; deliver the answer in the background.
  waitUntil(deliverToSlack(responseUrl, () => buildDataReply(teamId, cmd)));
  return NextResponse.json({ response_type: 'ephemeral', text: 'One moment…' });
}
