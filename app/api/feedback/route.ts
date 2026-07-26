import { NextResponse } from 'next/server';
import { getRequestContext } from '../../../lib/authz';
import { sendBree } from '../../../lib/alerts';
import * as bree from '../../../lib/bree-messages';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Long enough for a paragraph of prose, short enough that a runaway paste can't
// be pushed at Slack. Slack's own block text limit is 3000 characters.
const MAX_LENGTH = 2000;

/**
 * POST /api/feedback — send a line of product feedback to the company's Bree
 * Slack channel.
 *
 * The Slack message is the record. Nothing is written to the database, there is
 * no category and no attachment: a row nobody reads is worse than a message in
 * the channel the team is already in.
 *
 * Because there is no fallback store, delivery is reported honestly. When the
 * company has not connected Slack, or Slack rejects the post, this returns
 * `delivered: false` so the panel can say the feedback did not get through
 * rather than thanking the user for something that went nowhere.
 */
export async function POST(req: Request) {
  const { ctx, error } = await getRequestContext(req);
  if (error) return NextResponse.json({ error: error.message }, { status: error.status });

  const body = await req.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });
  if (text.length > MAX_LENGTH) {
    return NextResponse.json({ error: `text must be ${MAX_LENGTH} characters or fewer` }, { status: 400 });
  }

  const delivered = await sendBree(
    ctx.company.id,
    // name is optional on User; the email always identifies who wrote it.
    bree.feedback({ companyName: ctx.company.name, userName: ctx.user.name?.trim() || ctx.user.email, text })
  );

  return NextResponse.json({ delivered });
}
