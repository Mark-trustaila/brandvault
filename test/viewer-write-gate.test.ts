import { describe, it, expect } from 'vitest';
import { viewerWriteDenied, VIEWER_WRITE_MESSAGE } from '../lib/authz';

/**
 * The verb x role matrix for the shared write gate.
 *
 * Pinned here rather than inferred from whichever routes exist today: the
 * point of putting the check in getRequestContext is that a route added
 * tomorrow inherits it, and that guarantee is only worth as much as a test
 * that fails when the default flips.
 */
const WRITE_VERBS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const READ_VERBS = ['GET', 'HEAD', 'OPTIONS'];

const deny = (o: Partial<Parameters<typeof viewerWriteDenied>[0]> = {}) =>
  viewerWriteDenied({ method: 'POST', role: 'viewer', isPlatformAdmin: false, ...o });

describe('viewer write gate', () => {
  it('denies a viewer on every mutating verb', () => {
    for (const method of WRITE_VERBS) {
      expect(deny({ method }), `${method} should be denied`).toBe(true);
    }
  });

  it('allows a viewer on every read verb', () => {
    for (const method of READ_VERBS) {
      expect(deny({ method }), `${method} should be allowed`).toBe(false);
    }
  });

  it('is case-insensitive about the verb', () => {
    expect(deny({ method: 'post' })).toBe(true);
    expect(deny({ method: 'delete' })).toBe(true);
  });

  it('allows an admin on every verb', () => {
    for (const method of [...WRITE_VERBS, ...READ_VERBS]) {
      expect(deny({ method, role: 'admin' }), `admin ${method}`).toBe(false);
    }
  });

  it('allows an editor on every verb', () => {
    for (const method of [...WRITE_VERBS, ...READ_VERBS]) {
      expect(deny({ method, role: 'editor' }), `editor ${method}`).toBe(false);
    }
  });

  // Cross-tenant data correction is the whole point of the flag, and a platform
  // admin whose own membership resolved to viewer must still be able to onboard.
  it('allows a platform admin even when their own row says viewer', () => {
    for (const method of WRITE_VERBS) {
      expect(deny({ method, role: 'viewer', isPlatformAdmin: true }), `platform admin ${method}`).toBe(false);
    }
  });

  it('honours an explicit opt-out for non-write POSTs', () => {
    expect(deny({ method: 'POST', allowViewer: true })).toBe(false);
    expect(deny({ method: 'DELETE', allowViewer: true })).toBe(false);
  });

  // Fail closed: omitting the option must gate, never open.
  it('denies by default when no option is passed', () => {
    expect(viewerWriteDenied({ method: 'POST', role: 'viewer', isPlatformAdmin: false })).toBe(true);
  });

  it('tolerates a missing or odd method without opening the gate', () => {
    expect(deny({ method: '' })).toBe(false); // not a known mutating verb
    expect(deny({ method: undefined as unknown as string })).toBe(false);
  });

  it('states a plain reason', () => {
    expect(VIEWER_WRITE_MESSAGE).toMatch(/read-only/i);
    expect(VIEWER_WRITE_MESSAGE.length).toBeGreaterThan(20);
  });
});

/**
 * Which routes opt out. A guard against the opt-out spreading quietly: if a new
 * route needs allowViewer it should be a deliberate, reviewed addition here.
 */
describe('viewer opt-out surface', () => {
  it('is limited to the four non-write POSTs', async () => {
    const { readFileSync, readdirSync } = await import('fs');
    const { join } = await import('path');
    // Plain walk rather than a glob dependency: this test exists to keep the
    // opt-out surface small, and adding a package to check that would be odd.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'route.ts' ? [join(dir, e.name)] : []
      );
    const files = walk('app/api');
    const optedOut = files.filter((f) => readFileSync(f, 'utf8').includes('allowViewer: true')).sort();
    expect(optedOut).toEqual([
      'app/api/bree/route.ts',
      'app/api/feedback/route.ts',
      'app/api/notifications/[id]/read/route.ts',
      // Smart Search submit. A search writes nothing and is a POST only because
      // a term and a class list need a body — the same reason /api/bree is here.
      // Gating it would mean a viewer-seat lawyer cannot run a clearance search.
      'app/api/smart-search/route.ts',
    ]);
  });
});
