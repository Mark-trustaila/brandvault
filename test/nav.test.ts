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
import {
  NAV_WIDTH, RAIL_WIDTH, RAIL_WIDTH_NARROW, CENTRE_FLOOR,
  RAIL_FULL_FROM, RAIL_IN_FLOW_FROM,
} from '../lib/layout';

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

/**
 * The three columns are a system, not three numbers.
 *
 * Pinned as relationships wherever one exists, because a number in a test is a
 * number someone updates when it fails. The one place numbers are asserted is
 * the arithmetic itself — that the columns add up at each breakpoint — which is
 * the thing that would otherwise be checked by eye against a screenshot.
 */
describe('the column system', () => {
  const globals = readFileSync('app/globals.css', 'utf8');
  const shellCss = readFileSync('components/layout/AppShell.module.css', 'utf8');
  const detailCss = readFileSync('components/detail/DetailPanel.module.css', 'utf8');

  /**
   * The body of one CSS rule.
   *
   * Needed because `/\.panel \{[\s\S]*?width: \d+px/` cheerfully matches a
   * `width` in some later rule and reports the opposite of the truth — which is
   * exactly what it did the first time these were written.
   */
  const ruleBody = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    if (at === -1) return '';
    return css.slice(at, css.indexOf('}', at));
  };

  const cssVar = (css: string, name: string, after?: string) => {
    const scope = after ? css.slice(css.indexOf(after)) : css;
    return Number(scope.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1]);
  };

  // The constants are documentation and test fixtures; globals.css is the
  // source. A test rather than a convention, because two places holding one
  // number is exactly what drifts.
  it('declares the same widths in CSS and in the constants', () => {
    expect(cssVar(globals, 'sidebar-width')).toBe(NAV_WIDTH);
    expect(cssVar(globals, 'centre-floor')).toBe(CENTRE_FLOOR);
    expect(cssVar(globals, 'rail-width')).toBe(RAIL_WIDTH_NARROW);
    expect(cssVar(globals, 'rail-width', '@media (min-width: 1440px)')).toBe(RAIL_WIDTH);
    expect(globals).toContain(`@media (min-width: ${RAIL_FULL_FROM}px)`);
    expect(shellCss).toContain(`@media (max-width: ${RAIL_IN_FLOW_FROM - 1}px)`);
  });

  // The relationship that keeps a panel from moving an edge when it opens.
  // One variable, read by both, so they cannot drift — including across the
  // 1440 breakpoint, where both change because there is only one number.
  it('gives the panel the rail\'s width, from the rail\'s own variable', () => {
    expect(ruleBody(shellCss, '.railBox')).toContain('width: var(--rail-width)');
    expect(ruleBody(detailCss, '.panel')).toContain('width: var(--rail-width)');
    // Not a number anywhere in that rule: a hardcoded width is the drift.
    expect(ruleBody(detailCss, '.panel')).not.toMatch(/width: \d+px/);
  });

  it('opens the panel flush with the rail, at the right edge', () => {
    expect(ruleBody(detailCss, '.panel')).toMatch(/right: 0/);
  });

  it('floors the centre and lets it grow without limit', () => {
    expect(ruleBody(shellCss, '.centre')).toContain('min-width: var(--centre-floor)');
    expect(ruleBody(shellCss, '.centre')).not.toContain('max-width');
  });

  // The published table, checked rather than trusted.
  it('adds up at every breakpoint', () => {
    const railAt = (w: number) => (w >= RAIL_FULL_FROM ? RAIL_WIDTH : RAIL_WIDTH_NARROW);
    const centreAt = (w: number) => w - NAV_WIDTH - railAt(w);
    expect([1280, 1440, 1680, 1920].map((w) => [w, NAV_WIDTH, centreAt(w), railAt(w)])).toEqual([
      [1280, 240, 640, 400],
      [1440, 240, 760, 440],
      [1680, 240, 1000, 440],
      [1920, 240, 1240, 440],
    ]);
  });

  // 1280 is the breakpoint precisely because it is where the centre reaches its
  // floor. If either number moves without the other, this is what says so.
  it('puts the rail out of the flow exactly where the centre would go under', () => {
    expect(RAIL_IN_FLOW_FROM - NAV_WIDTH - RAIL_WIDTH_NARROW).toBe(CENTRE_FLOOR);
    expect(shellCss).toMatch(/@media \(max-width: 1279px\) \{[\s\S]*?\.railBox \{ display: none/);
  });

  // The wider rail is for the cards; two columns in the panel is the visible
  // half of that, and it arrives at the same breakpoint the width does.
  it('returns the panel grid to two columns with the wider rail', () => {
    expect(detailCss).toMatch(/@media \(min-width: 1440px\) \{[\s\S]*?grid-template-columns: 1fr 1fr/);
    expect(ruleBody(detailCss, '.grid')).toContain('grid-template-columns: 1fr;');
  });

  it('keeps the four footer actions on one row', () => {
    expect(ruleBody(detailCss, '.footer')).toContain('flex-wrap: nowrap');
    expect(ruleBody(detailCss, '.footerBtn')).toContain('white-space: nowrap');
  });

  // Both slide-overs use one class, so they cannot open at different widths.
  it('opens both side panels from one class', () => {
    expect(readFileSync('components/clearance/HitPanel.tsx', 'utf8')).toContain('styles.panel');
    expect(readFileSync('components/detail/DetailPanel.tsx', 'utf8')).toContain('styles.panel');
  });

  it('steps Bree out from under an open panel, by the same variable', () => {
    const bree = readFileSync('components/bree/BreeWidget.tsx', 'utf8');
    expect(bree).toContain('sidePanelOpen');
    expect(bree).toContain('calc(var(--rail-width) + 20px)');
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
