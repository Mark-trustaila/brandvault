import crypto from 'crypto';

/**
 * Slack (Bree) config + OAuth helpers. Credentials come from env
 * (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET). The bot the
 * user installs posts as "Bree".
 */
export const DEFAULT_APP_BASE_URL = 'https://brandvault-asos.vercel.app';

/**
 * Normalise the configured base URL.
 *
 * Every deep link in the product is built from this one value, and a dashboard
 * or CLI slip puts characters in it that break every link at once rather than
 * failing loudly. Both have happened here: the value was saved empty (`??`
 * accepts an empty string, so links came out relative and Slack could not
 * render them), and then saved with a trailing newline (non-empty, so `||`
 * would accept it, and the newline lands in the middle of every URL).
 *
 * So: trim surrounding whitespace, drop trailing slashes so a configured
 * "https://host/" cannot produce "https://host//watch/x", and fall back on
 * anything that is empty after trimming.
 */
export function normaliseBaseUrl(raw: string | undefined, fallback = DEFAULT_APP_BASE_URL): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return trimmed || fallback;
}

export const APP_BASE_URL = normaliseBaseUrl(process.env.NEXT_PUBLIC_APP_URL);

// Bot-token scopes requested at install (must match the Slack app config).
export const SLACK_SCOPES = ['chat:write', 'chat:write.public', 'channels:read', 'team:read', 'commands'];

export function slackConfig() {
  return {
    clientId: process.env.SLACK_CLIENT_ID ?? '',
    clientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    redirectUri: `${APP_BASE_URL}/api/slack/oauth-callback`,
  };
}

export function slackConfigured(): boolean {
  const c = slackConfig();
  return Boolean(c.clientId && c.clientSecret && c.signingSecret);
}

// The OAuth "state" ties the install back to the company that started it.
// Signed with the signing secret so it can't be tampered with (companyId is a
// cuid — no dots — so '.' is a safe separator).
function stateSecret(): string {
  return process.env.SLACK_SIGNING_SECRET || 'dev-secret';
}
export function signState(companyId: string): string {
  const sig = crypto.createHmac('sha256', stateSecret()).update(companyId).digest('hex').slice(0, 32);
  return `${companyId}.${sig}`;
}
export function verifyState(state: string): string | null {
  const [companyId, sig] = (state ?? '').split('.');
  if (!companyId || !sig || sig.length !== 32) return null;
  const expected = crypto.createHmac('sha256', stateSecret()).update(companyId).digest('hex').slice(0, 32);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? companyId : null;
  } catch {
    return null;
  }
}

export function authorizeUrl(companyId: string): string {
  const c = slackConfig();
  const u = new URL('https://slack.com/oauth/v2/authorize');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('scope', SLACK_SCOPES.join(','));
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('state', signState(companyId));
  return u.toString();
}

type OAuthAccess = {
  ok: boolean;
  access_token?: string; // bot token
  team?: { id: string; name: string };
  error?: string;
};

export async function exchangeCode(code: string): Promise<OAuthAccess> {
  const c = slackConfig();
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code,
      redirect_uri: c.redirectUri,
    }),
  });
  return (await res.json()) as OAuthAccess;
}

// Post a message as Bree. Best-effort — callers log/ignore failures so a Slack
// outage never blocks a DB write. Returns Slack's {ok,error} response.
//
// username + icon_url pin the sender's name and avatar so posted messages
// (digests, alerts) match the Bree app icon shown on slash-command replies,
// independent of the Slack app's configured name. The icon is self-hosted at
// public/bree-icon.png so it doesn't depend on a Slack CDN URL.
const BREE_ICON_URL = `${APP_BASE_URL}/bree-icon.png`;

export async function postToSlack(
  botToken: string,
  channel: string,
  msg: { text: string; blocks?: unknown[] }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${botToken}` },
      // Unfurling is suppressed on every Bree message. Deep links point at
      // company-scoped routes, so Slack's unauthenticated crawler gets a 404
      // and renders it as a broken preview under an otherwise clean alert.
      body: JSON.stringify({
        channel,
        text: msg.text,
        blocks: msg.blocks,
        username: 'Bree',
        icon_url: BREE_ICON_URL,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Verify a Slack request signature (v0 scheme) — pure, testable.
 * Rejects requests older than 5 minutes (replay) and mismatched signatures.
 * Pass `now` (seconds) for deterministic tests.
 */
export function verifySlackSignature(o: {
  signingSecret: string;
  timestamp: string;
  body: string;
  signature: string;
  now?: number;
}): boolean {
  if (!o.signingSecret || !o.timestamp || !o.signature) return false;
  const now = o.now ?? Date.now() / 1000;
  const age = Math.abs(now - Number(o.timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = 'v0=' + crypto.createHmac('sha256', o.signingSecret).update(`v0:${o.timestamp}:${o.body}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(o.signature));
  } catch {
    return false;
  }
}
