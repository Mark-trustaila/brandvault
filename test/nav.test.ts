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
  NAV_WIDTH, RAIL_WIDTH, PANEL_WIDTH, CENTRE_FLOOR,
  PANEL_IN_FLOW_FROM, RAIL_IN_FLOW_FROM,
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
/**
 * The three columns are a system, not a set of numbers.
 *
 * Pinned as relationships wherever one exists, because a number in a test is a
 * number someone updates when it fails. The one place numbers are asserted is
 * the arithmetic — that the columns add up, closed and open — which is the
 * thing that would otherwise be checked by eye against a screenshot.
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

  const cssVar = (css: string, name: string) =>
    Number(css.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1]);

  it('declares the same widths in CSS and in the constants', () => {
    expect(cssVar(globals, 'sidebar-width')).toBe(NAV_WIDTH);
    expect(cssVar(globals, 'rail-width')).toBe(RAIL_WIDTH);
    expect(cssVar(globals, 'panel-width')).toBe(PANEL_WIDTH);
    expect(cssVar(globals, 'centre-floor')).toBe(CENTRE_FLOOR);
  });

  // The rail is 320 at every viewport it is in the flow at. The 1440 step is
  // gone: the rail no longer has to be wide enough to be a panel.
  it('holds the rail at one width, closed, at every viewport', () => {
    expect(RAIL_WIDTH).toBe(320);
    expect(globals).not.toContain('@media (min-width: 1440px)');
    expect(ruleBody(shellCss, '.railBox')).toContain('flex: 0 0 var(--rail-width)');
  });

  // Open, the rail takes the panel's width by reference rather than by a second
  // copy of 440. That is what makes "the panel equals the open rail" a fact
  // about the stylesheet rather than a coincidence to police.
  it('gives the open rail the panel\'s width, by reference', () => {
    expect(PANEL_WIDTH).toBe(440);
    expect(shellCss).toMatch(/\.panelOpen \{ --rail-width: var\(--panel-width\); \}/);
    expect(ruleBody(detailCss, '.panel')).toContain('width: var(--panel-width)');
    expect(ruleBody(detailCss, '.panel')).not.toMatch(/width: \d+px/);
  });

  it('opens the panel flush with the rail, at the right edge', () => {
    expect(ruleBody(detailCss, '.panel')).toMatch(/right: 0/);
  });

  it('floors the centre and lets it grow without limit', () => {
    expect(ruleBody(shellCss, '.centre')).toContain('min-width: var(--centre-floor)');
    expect(ruleBody(shellCss, '.centre')).not.toContain('max-width');
  });

  const railAt = (w: number, open: boolean) =>
    (open && w >= PANEL_IN_FLOW_FROM ? PANEL_WIDTH : RAIL_WIDTH);
  const centreAt = (w: number, open: boolean) => w - NAV_WIDTH - railAt(w, open);

  it('adds up closed', () => {
    expect([1280, 1440, 1680, 1920].map((w) => [w, NAV_WIDTH, centreAt(w, false), railAt(w, false)])).toEqual([
      [1280, 240, 720, 320],
      [1440, 240, 880, 320],
      [1680, 240, 1120, 320],
      [1920, 240, 1360, 320],
    ]);
  });

  it('adds up open', () => {
    expect([1320, 1440, 1680, 1920].map((w) => [w, NAV_WIDTH, centreAt(w, true), railAt(w, true)])).toEqual([
      [1320, 240, 640, 440],
      [1440, 240, 760, 440],
      [1680, 240, 1000, 440],
      [1920, 240, 1240, 440],
    ]);
  });

  // The centre's floor is never breached, open or closed, at any viewport where
  // the rail is in the flow. This is the whole constraint in one assertion.
  it('never puts the centre under its floor', () => {
    for (let w = RAIL_IN_FLOW_FROM; w <= 2560; w += 1) {
      for (const open of [false, true]) {
        expect(centreAt(w, open), `${w} open=${open}`).toBeGreaterThanOrEqual(CENTRE_FLOOR);
      }
    }
  });

  // 1320 is the breakpoint precisely because it is where taking the panel's
  // width would reach the floor. If either number moves without the other,
  // this is what says so.
  it('opens in the flow exactly where there is room for it', () => {
    expect(PANEL_IN_FLOW_FROM - NAV_WIDTH - PANEL_WIDTH).toBe(CENTRE_FLOOR);
    expect(shellCss).toContain(`@media (min-width: ${PANEL_IN_FLOW_FROM}px)`);
  });

  it('leaves the rail in the flow exactly where the closed centre would go under', () => {
    expect(RAIL_IN_FLOW_FROM - NAV_WIDTH - RAIL_WIDTH).toBeGreaterThanOrEqual(CENTRE_FLOOR);
    expect(shellCss).toMatch(/@media \(max-width: 1279px\) \{[\s\S]*?\.railBox \{ display: none/);
  });

  /**
   * Nothing above the shell intercepts a click when the panel is in the flow.
   *
   * The regression this pins: hiding the backdrop was not enough, because
   * `.overlay` is `position: fixed; inset: 0` — a full-viewport sheet the panel
   * sits inside — and it went on swallowing every click outside the panel. The
   * nav, the header actions and the list rows were all live and all
   * unreachable, which reads as the app having frozen rather than as a panel
   * being modal. In the flow a panel is a column and nothing about it is modal.
   */
  it('lets every click outside an in-flow panel through', () => {
    const inFlow = shellCss.slice(shellCss.indexOf(`@media (min-width: ${PANEL_IN_FLOW_FROM}px)`));
    // The sheet stops hit-testing...
    expect(inFlow).toMatch(/\.panelOpen :global\(\[data-panel-overlay\]\) \{ pointer-events: none; \}/);
    // ...and its children start again, which leaves exactly the panel clickable.
    expect(inFlow).toMatch(/\.panelOpen :global\(\[data-panel-overlay\]\) > \* \{ pointer-events: auto; \}/);
    // The backdrop is gone outright, not merely invisible.
    expect(inFlow).toMatch(/\.panelOpen :global\(\[data-panel-backdrop\]\) \{ display: none; \}/);
    for (const f of ['components/detail/DetailPanel.tsx', 'components/clearance/HitPanel.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('data-panel-overlay');
    }
  });

  // Below the breakpoint the panel is a slide-over again, and a slide-over is
  // modal: the backdrop is visible and clicking it closes.
  it('keeps the backdrop and click-to-close below the breakpoint', () => {
    const beforeInFlow = shellCss.slice(0, shellCss.indexOf(`@media (min-width: ${PANEL_IN_FLOW_FROM}px)`));
    expect(beforeInFlow).not.toContain('pointer-events');
    expect(beforeInFlow).not.toContain('data-panel-backdrop');
    for (const f of ['components/detail/DetailPanel.tsx', 'components/clearance/HitPanel.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src, `${f} backdrop closes`).toMatch(/data-panel-backdrop[\s\S]{0,120}onClick=/);
    }
  });

  // Clicking another row swaps the panel's content rather than doing nothing.
  it('swaps the panel\'s content when another row is clicked', () => {
    const panel = readFileSync('components/clearance/ResultsPanel.tsx', 'utf8');
    expect(panel).toContain('onOpen={onOpenHit ? () => onOpenHit(h, i) : undefined}');
    const page = readFileSync('app/clearance/page.tsx', 'utf8');
    expect(page).toContain('onOpenHit={(_h, i) => setOpenHit(i)}');
    // The portfolio's own panel swaps the same way: the rail's renewal list and
    // the mark rows both set the selected mark.
    expect(readFileSync('components/layout/RightPanel.tsx', 'utf8')).toContain('setSelectedTrademark(t)');
  });

  // Navigating closes what was open.
  it('closes the panel on a route change, and only on a change', () => {
    const shell = readFileSync('components/layout/AppShell.tsx', 'utf8');
    expect(shell).toContain('usePathname');
    expect(shell).toMatch(/if \(lastPath\.current === pathname\) return;/);
    expect(shell).toContain('setSelectedTrademark(null)');
    expect(shell).toContain('setHitPanelOpen(false)');
  });

  // Escape closes both, which in the flow is the only way out besides the
  // button: there is no backdrop left to click.
  it('closes both panels on Escape', () => {
    for (const f of ['components/detail/DetailPanel.tsx', 'components/clearance/HitPanel.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain("e.key === 'Escape'");
    }
  });

  // In the flow means in the flow: the rail's content steps aside and the
  // backdrop goes, so nothing is covered and there is nothing to dim.
  it('replaces the rail\'s content rather than covering it', () => {
    expect(shellCss).toMatch(/\.panelOpen :global\(\[data-rail-content\]\) \{ display: none; \}/);
    expect(shellCss).toMatch(/\.panelOpen :global\(\[data-panel-backdrop\]\) \{ display: none; \}/);
    const shell = readFileSync('components/layout/AppShell.tsx', 'utf8');
    expect(shell).toContain('data-rail-content');
    for (const f of ['components/detail/DetailPanel.tsx', 'components/clearance/HitPanel.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('data-panel-backdrop');
    }
  });

  // The open state is one flag in one place, so the width, the rail's content
  // and the backdrop cannot disagree about whether a panel is open.
  it('drives all of it from one class on the shell', () => {
    const shell = readFileSync('components/layout/AppShell.tsx', 'utf8');
    expect(shell).toContain('sidePanelOpen ? ` ${styles.panelOpen}` : \'\'');
  });

  // The panel is 440 everywhere, so the two-column grid it was sized for is
  // unconditional. It was behind a media query only while the panel inherited
  // the rail's narrower width.
  it('runs the panel grid at two columns unconditionally', () => {
    expect(ruleBody(detailCss, '.grid')).toContain('grid-template-columns: 1fr 1fr');
    expect(detailCss).not.toContain('@media (min-width: 1440px)');
  });

  it('keeps the four footer actions on one row', () => {
    expect(ruleBody(detailCss, '.footer')).toContain('flex-wrap: nowrap');
    expect(ruleBody(detailCss, '.footerBtn')).toContain('white-space: nowrap');
  });

  it('opens both side panels from one class', () => {
    expect(readFileSync('components/clearance/HitPanel.tsx', 'utf8')).toContain('styles.panel');
    expect(readFileSync('components/detail/DetailPanel.tsx', 'utf8')).toContain('styles.panel');
  });

  it('steps Bree out from under an open panel, by the panel\'s variable', () => {
    const bree = readFileSync('components/bree/BreeWidget.tsx', 'utf8');
    expect(bree).toContain('sidePanelOpen');
    expect(bree).toContain('calc(var(--panel-width) + 20px)');
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
