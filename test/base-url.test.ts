import { describe, it, expect } from 'vitest';
import { normaliseBaseUrl, DEFAULT_APP_BASE_URL } from '../lib/slack';

const HOST = 'https://app.getbrandvault.com';

describe('normaliseBaseUrl', () => {
  it('passes a clean value through', () => {
    expect(normaliseBaseUrl(HOST)).toBe(HOST);
  });

  it('falls back when the variable is unset', () => {
    expect(normaliseBaseUrl(undefined)).toBe(DEFAULT_APP_BASE_URL);
  });

  it('falls back on an empty value rather than producing relative links', () => {
    // This shipped: ?? accepted "" and every deep link became "/watch/<id>",
    // which Slack cannot render as a link at all.
    expect(normaliseBaseUrl('')).toBe(DEFAULT_APP_BASE_URL);
    expect(normaliseBaseUrl('   ')).toBe(DEFAULT_APP_BASE_URL);
  });

  it('strips a trailing newline, which || would have accepted', () => {
    expect(normaliseBaseUrl(`${HOST}\n`)).toBe(HOST);
    expect(normaliseBaseUrl(`\n${HOST}\n`)).toBe(HOST);
    expect(normaliseBaseUrl(` ${HOST} `)).toBe(HOST);
  });

  it('strips trailing slashes so links never double up', () => {
    expect(normaliseBaseUrl(`${HOST}/`)).toBe(HOST);
    expect(normaliseBaseUrl(`${HOST}///`)).toBe(HOST);
  });

  it('builds a clean deep link from a dirty value', () => {
    expect(`${normaliseBaseUrl(`${HOST}\n`)}/watch/abc`).toBe(`${HOST}/watch/abc`);
  });
});
