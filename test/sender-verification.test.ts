import { describe, it, expect } from 'vitest';
import {
  verifySender,
  registryForDomain,
  parseAuthResults,
  domainOf,
  headerValues,
  looksForwarded,
  requiresSenderCaution,
} from '../lib/sender-verification';

const h = (Name: string, Value: string) => ({ Name, Value });

const AUTH = 'Authentication-Results';

describe('registryForDomain', () => {
  it('matches an allow-listed domain', () => {
    expect(registryForDomain('ipo.gov.uk')).toBe('UKIPO');
    expect(registryForDomain('euipo.europa.eu')).toBe('EUIPO');
    expect(registryForDomain('wipo.int')).toBe('WIPO');
  });

  it('matches a subdomain of an allow-listed domain', () => {
    expect(registryForDomain('mail.ipo.gov.uk')).toBe('UKIPO');
  });

  it('is case and trailing-dot insensitive', () => {
    expect(registryForDomain('MAIL.IPO.GOV.UK.')).toBe('UKIPO');
  });

  // The two ways a naive suffix check gets a spoof wrong.
  it('rejects a suffix collision', () => {
    expect(registryForDomain('notipo.gov.uk')).toBeNull();
  });

  it('rejects an allow-listed domain used as a prefix of another', () => {
    expect(registryForDomain('ipo.gov.uk.evil.com')).toBeNull();
  });

  it('rejects empty and missing input', () => {
    expect(registryForDomain(null)).toBeNull();
    expect(registryForDomain('')).toBeNull();
  });
});

describe('domainOf', () => {
  it('takes the domain from an address', () => {
    expect(domainOf('noreply@ipo.gov.uk')).toBe('ipo.gov.uk');
  });

  it('unwraps a display-name address', () => {
    expect(domainOf('UK IPO <noreply@ipo.gov.uk>')).toBe('ipo.gov.uk');
  });

  it('accepts a bare domain', () => {
    expect(domainOf('ipo.gov.uk')).toBe('ipo.gov.uk');
  });

  it('rejects something with no dot', () => {
    expect(domainOf('localhost')).toBeNull();
    expect(domainOf('')).toBeNull();
  });
});

describe('headerValues', () => {
  it('is case-insensitive and returns every hop', () => {
    const headers = [h('Received', 'a'), h('received', 'b'), h('Subject', 'x')];
    expect(headerValues(headers, 'RECEIVED')).toEqual(['a', 'b']);
  });
});

describe('parseAuthResults', () => {
  it('parses methods, results and properties', () => {
    const parsed = parseAuthResults(['mx.google.com; dkim=pass header.d=ipo.gov.uk; spf=pass smtp.mailfrom=noreply@ipo.gov.uk']);
    expect(parsed).toEqual([
      { method: 'dkim', result: 'pass', props: { 'header.d': 'ipo.gov.uk' } },
      { method: 'spf', result: 'pass', props: { 'smtp.mailfrom': 'noreply@ipo.gov.uk' } },
    ]);
  });

  // A comment can contain both ";" and "=", which naive splitting breaks on.
  it('ignores parenthesised comments containing separators', () => {
    const parsed = parseAuthResults(['mx.google.com; spf=pass (google.com: domain of x@y designates 1.2.3.4; ok=yes) smtp.mailfrom=x@ipo.gov.uk']);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ method: 'spf', result: 'pass', props: { 'smtp.mailfrom': 'x@ipo.gov.uk' } });
  });

  it('skips the authserv-id and unknown methods', () => {
    const parsed = parseAuthResults(['mx.google.com; iprev=pass; dkim=fail header.d=evil.com']);
    expect(parsed).toEqual([{ method: 'dkim', result: 'fail', props: { 'header.d': 'evil.com' } }]);
  });

  it('returns nothing for an empty list', () => {
    expect(parseAuthResults([])).toEqual([]);
  });
});

describe('verifySender', () => {
  it('verifies a registry DKIM pass', () => {
    const v = verifySender({
      fromAddress: 'noreply@ipo.gov.uk',
      rawHeaders: [h(AUTH, 'mx.google.com; dkim=pass header.d=ipo.gov.uk; spf=fail smtp.mailfrom=forwarder@example.com')],
    });
    expect(v.verdict).toBe('verified');
    expect(v.registry).toBe('UKIPO');
    expect(v.domain).toBe('ipo.gov.uk');
  });

  // The whole reason SPF is not a negative signal: forwarding breaks it, and a
  // genuine registry notice must not be condemned for arriving the normal way.
  it('still verifies when forwarding has broken SPF', () => {
    const v = verifySender({
      fromAddress: 'noreply@euipo.europa.eu',
      rawHeaders: [
        h(AUTH, 'mx.google.com; dkim=pass header.d=euipo.europa.eu; spf=softfail smtp.mailfrom=legal@customer.com'),
        h('X-Forwarded-For', 'legal@customer.com'),
      ],
    });
    expect(v.verdict).toBe('verified');
    expect(v.registry).toBe('EUIPO');
  });

  it('accepts a subdomain signature', () => {
    const v = verifySender({
      fromAddress: 'noreply@ipo.gov.uk',
      rawHeaders: [h(AUTH, 'mx; dkim=pass header.d=mail.ipo.gov.uk')],
    });
    expect(v.verdict).toBe('verified');
    expect(v.registry).toBe('UKIPO');
  });

  it('flags a DKIM failure for a domain claiming to be a registry', () => {
    const v = verifySender({
      fromAddress: 'noreply@ipo.gov.uk',
      rawHeaders: [h(AUTH, 'mx.google.com; dkim=fail header.d=ipo.gov.uk')],
    });
    expect(v.verdict).toBe('failed');
    expect(v.registry).toBe('UKIPO');
  });

  it('flags a DMARC failure against the From domain', () => {
    const v = verifySender({
      fromAddress: 'noreply@ipo.gov.uk',
      rawHeaders: [h(AUTH, 'mx.google.com; dmarc=fail header.from=ipo.gov.uk')],
    });
    expect(v.verdict).toBe('failed');
    expect(v.registry).toBe('UKIPO');
  });

  // The spoof this module exists to catch: the display domain claims UKIPO,
  // but the only passing signature belongs to someone else entirely.
  it('does not verify when a passing signature belongs to another domain', () => {
    const v = verifySender({
      fromAddress: 'noreply@ipo.gov.uk',
      rawHeaders: [h(AUTH, 'mx.google.com; dkim=pass header.d=evil.com')],
    });
    expect(v.verdict).not.toBe('verified');
    expect(v.registry).toBe('UKIPO'); // what it claims to be
    expect(v.domain).toBe('ipo.gov.uk');
  });

  it('does not fail a non-registry domain that fails its own DKIM', () => {
    const v = verifySender({
      fromAddress: 'someone@randomfirm.com',
      rawHeaders: [h(AUTH, 'mx.google.com; dkim=fail header.d=randomfirm.com')],
    });
    expect(v.verdict).toBe('forwarded_unverifiable');
    expect(v.registry).toBeNull();
  });

  it('reports forwarded mail with no surviving signature as unproven, not hostile', () => {
    const v = verifySender({
      fromAddress: 'noreply@ipo.gov.uk',
      rawHeaders: [h('X-Forwarded-For', 'legal@customer.com')],
    });
    expect(v.verdict).toBe('forwarded_unverifiable');
    expect(v.registry).toBe('UKIPO');
    expect(v.reason).toContain('not proven');
  });

  it('reports a total absence of authentication headers', () => {
    const v = verifySender({ fromAddress: 'noreply@ipo.gov.uk', rawHeaders: [] });
    expect(v.verdict).toBe('unverified');
  });

  it('never throws on missing or malformed input', () => {
    expect(verifySender({}).verdict).toBe('unverified');
    expect(verifySender({ fromAddress: null, rawHeaders: null }).verdict).toBe('unverified');
    expect(verifySender({ fromAddress: 'x', rawHeaders: 'not-an-array' }).verdict).toBe('unverified');
    expect(verifySender({ rawHeaders: [{ Name: 'X', Value: undefined } as never] }).verdict).toBe('unverified');
  });

  it('always gives a reason a reviewer could read', () => {
    for (const v of [
      verifySender({ fromAddress: 'a@ipo.gov.uk', rawHeaders: [h(AUTH, 'mx; dkim=pass header.d=ipo.gov.uk')] }),
      verifySender({ fromAddress: 'a@ipo.gov.uk', rawHeaders: [h(AUTH, 'mx; dkim=fail header.d=ipo.gov.uk')] }),
      verifySender({ fromAddress: 'a@ipo.gov.uk', rawHeaders: [h('X-Forwarded-For', 'x')] }),
      verifySender({}),
    ]) {
      expect(v.reason.length).toBeGreaterThan(20);
      expect(v.reason.trim()).toMatch(/\.$/);
    }
  });
});

describe('looksForwarded', () => {
  it('spots a forwarding header', () => {
    expect(looksForwarded([h('X-Forwarded-For', 'a@b.com')])).toBe(true);
    expect(looksForwarded([h('Resent-From', 'a@b.com')])).toBe(true);
  });

  it('is false for a plain message', () => {
    expect(looksForwarded([h('Subject', 'hello')])).toBe(false);
  });
});

describe('requiresSenderCaution', () => {
  it('is false only for a verified sender', () => {
    const verified = verifySender({ fromAddress: 'a@ipo.gov.uk', rawHeaders: [h(AUTH, 'mx; dkim=pass header.d=ipo.gov.uk')] });
    const forwarded = verifySender({ fromAddress: 'a@ipo.gov.uk', rawHeaders: [] });
    expect(requiresSenderCaution(verified)).toBe(false);
    expect(requiresSenderCaution(forwarded)).toBe(true);
  });
});
