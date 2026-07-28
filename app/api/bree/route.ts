import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { getRequestContext } from '../../../lib/authz';
import { classifyIntent } from '../../../lib/bree-intent';
import { handleBreeQuery } from '../../../lib/bree-web';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/bree — the web sidebar's query endpoint. Clerk-authenticated,
// company-scoped. Free text is classified by the NL intent layer and routed to
// the same read-only handlers as the Slack slash commands (portfolio / renewals
// / status), or answered with a capability message (unsupported). Every call is
// logged to BreeQueryLog (Phase 5 evidence). Responses are ephemeral to the
// session — nothing is persisted as conversation, nothing is synced to Slack.
export async function POST(req: Request) {
  // POST is a transport detail: this is a read-only question that needs a
  // body. Viewers must be able to ask Bree about their own portfolio.
  const { ctx, error } = await getRequestContext(req, { allowViewer: true });
  if (error) return NextResponse.json({ error: error.message }, { status: error.status });

  const body = await req.json().catch(() => ({}));
  const query = typeof body?.query === 'string' ? body.query.slice(0, 500) : '';

  const started = Date.now();
  const outcome = await handleBreeQuery(ctx.company.id, query, classifyIntent);
  const latencyMs = Date.now() - started;

  // Log every classification — including unsupported and API-failure fallbacks.
  await prisma.breeQueryLog
    .create({
      data: {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        inputText: query,
        resolvedIntent: outcome.resolvedIntent,
        matchedTrademarkId: outcome.matchedTrademarkId,
        latencyMs,
        fallback: outcome.fallback,
      },
    })
    .catch(() => {}); // logging must never break the reply

  return NextResponse.json({ answer: outcome.reply });
}
