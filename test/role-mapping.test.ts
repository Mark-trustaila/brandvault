import { describe, it, expect } from 'vitest';
import { __mapRoleForTest as mapRole } from '../lib/tenant';

/**
 * This mapping decides write access, so it is pinned rather than left to
 * inspection. resolveUser applies it on every authenticated request, which
 * means a change here silently re-roles every existing user on their next
 * request — worth a failing test rather than a surprise.
 */
describe('mapRole', () => {
  it('makes a Clerk org admin an admin', () => {
    expect(mapRole('org:admin')).toBe('admin');
  });

  it('makes an ordinary member a viewer, not an editor', () => {
    expect(mapRole('org:member')).toBe('viewer');
  });

  // Fail closed: a custom Clerk role added later must not grant more than
  // intended just because nobody updated this function.
  it('maps anything unrecognised to viewer', () => {
    for (const role of ['org:billing', 'org:guest', 'admin', 'ORG:ADMIN', '', 'editor']) {
      expect(mapRole(role)).toBe('viewer');
    }
  });

  it('maps a missing role to viewer', () => {
    expect(mapRole(undefined)).toBe('viewer');
    expect(mapRole(null)).toBe('viewer');
  });

  // Documents the consequence recorded in CLAUDE.md: no Clerk role currently
  // produces editor, so it cannot be reached through login.
  it('never produces editor from any Clerk role', () => {
    const roles = ['org:admin', 'org:member', 'org:billing', 'org:editor', null, undefined, ''];
    expect(roles.map((r) => mapRole(r))).not.toContain('editor');
  });
});
