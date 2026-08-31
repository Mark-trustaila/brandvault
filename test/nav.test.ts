/**
 * Route to nav view, and the frame around every route.
 *
 * The mapping is pure, so it is tested directly. The frame is checked at
 * source level, because "this page composes its own chrome" is exactly the
 * regression that looks fine in isolation and only shows up when someone
 * navigates between two views and the furniture moves.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { NAV_VIEWS, viewForPath, breadcrumbLabel, isActive } from '../lib/nav';

describe('viewForPath', () => {
  it('maps each route to its view', () => {
    expect(viewForPath('/settings/alerts')?.label).toBe('Alerts');
    expect(viewForPath('/')?.label).toBe('Dashboard');
    expect(viewForPath('/clearance')?.label).toBe('Registry searches');
    expect(viewForPath('/inbox')?.label).toBe('Inbox');
    expect(viewForPath('/whats-new')?.label).toBe("What's new");
  });

  it('tolerates a trailing slash and a query string', () => {
    expect(viewForPath('/inbox/')?.href).toBe('/inbox');
    expect(viewForPath('/clearance?search=abc')?.href).toBe('/clearance');
  });

  // Longest match wins, so a child route resolves to its own view rather than
  // to Dashboard on the strength of its leading slash.
  it('resolves a child route to its parent view, not to Dashboard', () => {
    expect(viewForPath('/clearance/anything')?.href).toBe('/clearance');
    expect(viewForPath('/watch/abc')).toBeNull();
  });

  // Admin stays outside the frame pending the suite settings design, so it is
  // off the map and highlights nothing.
  it('highlights nothing off the map', () => {
    expect(viewForPath('/admin/import')).toBeNull();
    expect(viewForPath('/admin/bulk')).toBeNull();
    expect(viewForPath('/sign-in')).toBeNull();
    expect(isActive('/admin/import', '/')).toBe(false);
  });
});

describe('the active entry', () => {
  it('is the current route and only the current route', () => {
    for (const view of NAV_VIEWS) {
      for (const other of NAV_VIEWS) {
        expect(isActive(view.href, other.href), `${view.href} vs ${other.href}`)
          .toBe(view.href === other.href);
      }
    }
  });

  // The reported bug: Dashboard stayed lit from every other view.
  it('does not highlight Dashboard on the searches view', () => {
    expect(isActive('/clearance', '/')).toBe(false);
    expect(isActive('/clearance', '/clearance')).toBe(true);
  });
});

describe('breadcrumbLabel', () => {
  it('names the current view as its last segment', () => {
    expect(breadcrumbLabel('/')).toBe('Dashboard');
    expect(breadcrumbLabel('/clearance')).toBe('Registry searches');
    expect(breadcrumbLabel('/inbox')).toBe('Inbox');
    expect(breadcrumbLabel('/whats-new')).toBe("What's new");
  });

  it('falls back to the product name rather than lying', () => {
    expect(breadcrumbLabel('/admin/import')).toBe('BrandVault');
  });

  // One word for the nav entry and the breadcrumb, so what you clicked and
  // where you are cannot be named differently.
  it('uses the same word as the nav entry', () => {
    for (const v of NAV_VIEWS) expect(breadcrumbLabel(v.href)).toBe(v.label);
  });
});

describe('every view renders inside the frame', () => {
  const PAGES: Array<[string, string]> = [
    ['/', 'app/page.tsx'],
    ['/clearance', 'app/clearance/page.tsx'],
    ['/inbox', 'app/inbox/page.tsx'],
    ['/whats-new', 'app/whats-new/page.tsx'],
    ['/settings/alerts', 'app/settings/alerts/page.tsx'],
  ];

  it('has a page file for every nav view', () => {
    expect(PAGES.map(([href]) => href).sort()).toEqual(NAV_VIEWS.map((v) => v.href).sort());
  });

  it('renders the shell', () => {
    for (const [href, file] of PAGES) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${href} does not import AppShell`).toMatch(/from '(\.\.\/)+components\/layout\/AppShell'/);
      expect(src, `${href} does not render AppShell`).toMatch(/<AppShell[\s>]/);
    }
  });

  // No view composes its own chrome. The frame parts belong to AppShell.
  it('composes no chrome of its own', () => {
    for (const [href, file] of PAGES) {
      const src = readFileSync(file, 'utf8');
      for (const part of ['<Sidebar', '<Topbar', '<RightPanel', '<PlatformAdminBar']) {
        expect(src, `${href} composes ${part}`).not.toContain(part);
      }
    }
  });

  // The nav is the way back now.
  it('carries no back link', () => {
    for (const [href, file] of PAGES) {
      const src = readFileSync(file, 'utf8');
      expect(src, `${href} has a back link`).not.toContain('← Dashboard');
    }
  });
});

describe('the frame is the same width on every view', () => {
  const shell = readFileSync('components/layout/AppShell.tsx', 'utf8');
  const railCss = readFileSync('components/layout/RightPanel.module.css', 'utf8');

  // A rail that sized itself to its content would make the main column jump
  // between views, which reads as the page moving rather than the content.
  it('fixes the rail width in the shell, at the dashboard\'s width', () => {
    expect(shell).toContain('const RAIL_WIDTH = 340');
    expect(shell).toMatch(/flex: `0 0 \$\{RAIL_WIDTH\}px`/);
  });

  it('lets the rail fill that box and wrap, rather than demand a width', () => {
    expect(railCss).toMatch(/\.panel \{[\s\S]*?width: 100%/);
    expect(railCss).not.toMatch(/\.panel \{[\s\S]*?min-width: 340px/);
    expect(railCss).toMatch(/overflow-wrap: anywhere/);
  });

  it('lets the main column absorb the difference', () => {
    expect(shell).toMatch(/flex: 1, minWidth: 0/);
  });

  // Both slide-overs use one class, so they cannot open at different widths.
  it('opens both side panels at the same width', () => {
    const detailCss = readFileSync('components/detail/DetailPanel.module.css', 'utf8');
    const widths = detailCss.match(/\.panel \{[\s\S]*?width: (\d+)px/);
    expect(widths?.[1]).toBe('520');
    expect(readFileSync('components/clearance/HitPanel.tsx', 'utf8')).toContain('styles.panel');
    expect(readFileSync('components/detail/DetailPanel.tsx', 'utf8')).toContain('styles.panel');
  });
});

describe('the coverage caveat is stated once', () => {
  it('is out of the results panel, and the currency line stays', () => {
    const panel = readFileSync('components/clearance/ResultsPanel.tsx', 'utf8');
    expect(panel).toContain('Register data <strong>as at');
    expect(panel).not.toContain('c!.note');
    expect(panel).not.toMatch(/caveats\.map/);
  });

  it('is in the rail\'s data-source block, sourced from the registry', () => {
    const rail = readFileSync('components/layout/RightPanel.tsx', 'utf8');
    expect(rail).toContain('Data Source');
    expect(rail).toContain("fetch('/api/registry/coverage')");
    expect(rail).toMatch(/caveats\.map/);
    // Never written into the component: the figure moves when the ingest lands.
    expect(rail).not.toMatch(/72|UK009 \(Brexit/);
  });
});
