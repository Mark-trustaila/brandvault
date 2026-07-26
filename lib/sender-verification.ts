/**
 * Did this inbound email actually come from a registry?
 *
 * `POSTMARK_INBOUND_SECRET` authenticates the *webhook* (Postmark to us). It
 * says nothing about the *sender*. A spoofed "UKIPO" email forwarded to a
 * company's Bree address is classified like any other and can drive an approval
 * prompt, which is the gap logged in CLAUDE.md under Outstanding / deferred.
 *
 * This module is the check. It is pure: it reads the headers already stored on
 * every inbound email (`InboundEmail.rawHeadersJson`, populated since ingestion
 * shipped) and returns a verdict. No I/O, no database, no clock. Nothing here
 * is wired into the processor yet, so no behaviour changes by adding it.
 *
 * ## Why DKIM is the signal and SPF mostly is not
 *
 * The product's ingestion model is *forwarding*: mail lands in the customer's
 * own mailbox and is forwarded on to `bree-{slug}@`. Forwarding rewrites the
 * envelope sender, so SPF is evaluated against the forwarder and a genuine
 * registry email routinely arrives SPF-neutral or SPF-fail. Treating SPF
 * failure as a spoof signal would reject real mail.
 *
 * DKIM survives forwarding, because the signature covers the message itself
 * rather than the path. So the strong positive signal is a DKIM *pass* whose
 * signing domain (`header.d`) is a registry domain. Everything else is
 * unproven rather than hostile, and is reported as such.
 *
 * The one case that IS hostile: a DKIM or DMARC result that explicitly *fails*
 * for a domain claiming to be a registry. That is a forgery attempt, not a
 * forwarding artefact.
 */
import type { Registry } from './email-types';

export type RawHeader = { Name: string; Value: string };

export type SenderVerdict =
  /** DKIM passed and the signing domain is a known registry domain. */
  | 'verified'
  /** Authentication explicitly failed for a domain claiming to be a registry. */
  | 'failed'
  /** Looks forwarded, and no registry DKIM signature survived. Normal, but unproven. */
  | 'forwarded_unverifiable'
  /** No usable authentication headers at all. */
  | 'unverified';

export type SenderVerification = {
  verdict: SenderVerdict;
  /** The registry the authenticated domain belongs to, when there is one. */
  registry: Registry | null;
  /** The domain the verdict is about (DKIM signing domain, or the From domain). */
  domain: string | null;
  /** One plain sentence, safe to show a reviewer. */
  reason: string;
};

/**
 * Sending domains for the registries we ingest from.
 *
 * NOT templated and NOT guessed from the registry name: an allow-list is only
 * worth having if every entry is a domain we have actually seen sign real mail.
 * Confirm each against the corpus before relying on it in the UI, and add
 * subdomains explicitly rather than matching loosely.
 */
export const REGISTRY_DOMAINS: Record<string, Registry> = {
  'ipo.gov.uk': 'UKIPO',
  'euipo.europa.eu': 'EUIPO',
  'wipo.int': 'WIPO',
};

/**
 * Match a domain against the allow-list, allowing subdomains
 * (`mail.ipo.gov.uk` matches `ipo.gov.uk`) but never suffix collisions
 * (`notipo.gov.uk` must not match, and neither must `ipo.gov.uk.evil.com`).
 */
export function registryForDomain(domain: string | null | undefined): Registry | null {
  const d = (domain ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!d) return null;
  for (const [allowed, registry] of Object.entries(REGISTRY_DOMAINS)) {
    if (d === allowed || d.endsWith(`.${allowed}`)) return registry;
  }
  return null;
}

/** Case-insensitive header lookup. Returns every value, since hops repeat headers. */
export function headerValues(headers: RawHeader[], name: string): string[] {
  const want = name.toLowerCase();
  return (headers ?? [])
    .filter((h) => h && typeof h.Name === 'string' && h.Name.toLowerCase() === want)
    .map((h) => String(h.Value ?? ''));
}

export type AuthResult = {
  method: string; // dkim | spf | dmarc
  result: string; // pass | fail | none | neutral | softfail | temperror | permerror
  props: Record<string, string>; // header.d, smtp.mailfrom, header.from
};

/**
 * Parse `Authentication-Results` values into method/result/property triples.
 *
 * The header is a semicolon-separated list of `method=result` tokens, each
 * optionally followed by `key=value` properties and free-text comments in
 * parentheses. Comments can themselves contain semicolons and "=", so they are
 * stripped before splitting rather than parsed.
 */
export function parseAuthResults(values: string[]): AuthResult[] {
  const out: AuthResult[] = [];
  for (const raw of values) {
    const withoutComments = stripParens(raw);
    // First segment is the authserv-id, not a method; it has no "=" so the
    // method match below simply skips it.
    for (const segment of withoutComments.split(';')) {
      const s = segment.trim();
      if (!s) continue;
      const m = s.match(/^([A-Za-z][\w-]*)\s*=\s*([A-Za-z]+)/);
      if (!m) continue;
      const method = m[1].toLowerCase();
      if (!['dkim', 'spf', 'dmarc'].includes(method)) continue;
      const props: Record<string, string> = {};
      // Array.from rather than iterating the matchAll result directly: the
      // project targets a pre-ES2015 lib without downlevelIteration.
      for (const p of Array.from(s.slice(m[0].length).matchAll(/([\w.-]+)\s*=\s*("[^"]*"|[^\s;]+)/g))) {
        props[p[1].toLowerCase()] = p[2].replace(/^"|"$/g, '').toLowerCase();
      }
      out.push({ method, result: m[2].toLowerCase(), props });
    }
  }
  return out;
}

/** Remove parenthesised comments, including nested ones. */
function stripParens(s: string): string {
  let depth = 0;
  let out = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/** Domain part of an address, or of a bare domain. Null when unusable. */
export function domainOf(address: string | null | undefined): string | null {
  const a = (address ?? '').trim().toLowerCase();
  if (!a) return null;
  const inAngles = a.match(/<([^>]+)>/);
  const addr = inAngles ? inAngles[1] : a;
  const at = addr.lastIndexOf('@');
  const domain = (at >= 0 ? addr.slice(at + 1) : addr).trim().replace(/\.$/, '');
  return domain && domain.includes('.') ? domain : null;
}

/**
 * Headers that indicate the message reached us via a forward rather than
 * directly from the sender. Their presence turns "we could not verify this"
 * from suspicious into expected.
 */
const FORWARD_HINT_HEADERS = ['x-forwarded-for', 'x-forwarded-to', 'resent-from', 'resent-date', 'x-original-sender'];

export function looksForwarded(headers: RawHeader[]): boolean {
  const names = new Set((headers ?? []).map((h) => String(h?.Name ?? '').toLowerCase()));
  if (FORWARD_HINT_HEADERS.some((h) => names.has(h))) return true;
  // More than one Received hop is normal mail; a forward usually also carries
  // a Delivered-To differing from the envelope recipient. Kept deliberately
  // loose: this only softens a negative verdict, it never creates a positive.
  return headerValues(headers, 'delivered-to').length > 1;
}

/**
 * The verdict for one inbound email.
 *
 * Deliberately conservative in both directions. It will not call a message
 * verified without a registry DKIM pass, and it will not call a message failed
 * merely because forwarding broke SPF.
 */
export function verifySender(o: { fromAddress?: string | null; rawHeaders?: unknown }): SenderVerification {
  const headers: RawHeader[] = Array.isArray(o.rawHeaders) ? (o.rawHeaders as RawHeader[]) : [];
  const fromDomain = domainOf(o.fromAddress);
  const results = parseAuthResults(headerValues(headers, 'authentication-results'));

  // 1. A registry DKIM pass is the only thing that proves origin.
  for (const r of results) {
    if (r.method !== 'dkim' || r.result !== 'pass') continue;
    const signing = r.props['header.d'] ?? r.props['header.i'];
    const registry = registryForDomain(domainOf(signing) ?? signing ?? null);
    if (registry) {
      const domain = (domainOf(signing) ?? signing ?? '').toLowerCase();
      return {
        verdict: 'verified',
        registry,
        domain,
        reason: `DKIM signature from ${domain} verified, a known ${registry} sending domain.`,
      };
    }
  }

  // 2. An explicit failure for a domain claiming to be a registry is a forgery
  //    signal, not a forwarding artefact. SPF is excluded on purpose: forwarding
  //    breaks it routinely and a genuine notice would be condemned.
  const HARD_FAIL = new Set(['fail', 'permerror']);
  for (const r of results) {
    if (r.method === 'spf') continue;
    if (!HARD_FAIL.has(r.result)) continue;
    const claimed = domainOf(r.props['header.d'] ?? r.props['header.from'] ?? null) ?? fromDomain;
    const registry = registryForDomain(claimed);
    if (registry) {
      return {
        verdict: 'failed',
        registry,
        domain: claimed,
        reason: `${r.method.toUpperCase()} failed for ${claimed}, which claims to be ${registry}. Treat this as unverified correspondence.`,
      };
    }
  }

  // 3. No proof either way. Distinguish "arrived forwarded, so we never expected
  //    proof" from "no authentication headers at all", because they mean
  //    different things to whoever reviews it.
  const claimedRegistry = registryForDomain(fromDomain);
  if (looksForwarded(headers) || results.length > 0) {
    return {
      verdict: 'forwarded_unverifiable',
      registry: claimedRegistry,
      domain: fromDomain,
      reason: claimedRegistry
        ? `The message claims to be from ${claimedRegistry} but carries no surviving ${claimedRegistry} signature, which is normal for forwarded mail. Origin is not proven.`
        : 'No registry signature survived forwarding. Origin is not proven.',
    };
  }

  return {
    verdict: 'unverified',
    registry: claimedRegistry,
    domain: fromDomain,
    reason: 'No sender authentication headers are present. Origin is not proven.',
  };
}

/** True when a verdict should stop an approval prompt being raised on trust alone. */
export function requiresSenderCaution(v: SenderVerification): boolean {
  return v.verdict !== 'verified';
}
