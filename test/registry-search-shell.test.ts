/**
 * Registry search lives inside the application frame, and is named the same
 * thing everywhere.
 *
 * Source-level, in the spirit of test/viewer-write-gate.test.ts. What these
 * protect is easy to undo by accident and invisible in a unit test: a page that
 * quietly stops rendering the shell, a label that drifts back to the old word,
 * a second filled button appearing because one screen wanted emphasis.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(p, 'utf8');
const page = read('app/clearance/page.tsx');
const topbar = read('components/layout/Topbar.tsx');
const sidebar = read('components/layout/Sidebar.tsx');
const shell = read('components/layout/AppShell.tsx');
const hitPanel = read('components/clearance/HitPanel.tsx');

describe('the frame persists', () => {
  it('the dashboard and registry search render into the same shell', () => {
    expect(read('app/page.tsx')).toContain('<AppShell>');
    expect(page).toContain('<AppShell');
  });

  it('the shell owns the sidebar, top bar and right rail', () => {
    for (const part of ['<Sidebar />', '<Topbar />', '<RightPanel />', '<PlatformAdminBar />']) {
      expect(shell, part).toContain(part);
    }
  });

  // Only the main content area changes between pages, so the shared overlays
  // hang off the frame rather than being rebuilt per page.
  it('the shell owns the overlays that can open over any page', () => {
    for (const part of ['<DetailPanel />', '<ReportPanel />', '<MarkEditForm />', '<BreeWidget />']) {
      expect(shell, part).toContain(part);
    }
  });

  // The page fetched the portfolio itself; the frame needs it too, for the
  // sidebar's counts and the top bar's company name.
  it('fetches the portfolio once, in the frame', () => {
    expect(shell).toContain("bvFetch('/api/trademarks')");
    expect(read('app/page.tsx')).not.toContain("bvFetch('/api/trademarks')");
  });

  // A page inside the frame is not somewhere you go "back" from.
  it('registry search has no back link', () => {
    expect(page).not.toContain('← Dashboard');
    expect(page).not.toMatch(/href="\/"[^>]*>\s*←/);
  });
});

describe('vocabulary', () => {
  it('calls the action and the heading Registry search', () => {
    expect(topbar).toContain('Registry search');
    expect(page).toContain('<h1');
    expect(page).toContain('Registry search</h1>');
  });

  it('calls the nav entry Registry searches', () => {
    expect(sidebar).toContain('<span>Registry searches</span>');
  });

  // The word survives as the name of the report templates and as the route and
  // code identifiers; it is gone from anything a user reads.
  it('shows no "clearance" in user-facing copy', () => {
    const uiFiles = [
      'app/clearance/page.tsx',
      'components/clearance/ResultsPanel.tsx',
      'components/clearance/ClearancesTable.tsx',
      'components/clearance/HitPanel.tsx',
      'components/layout/Topbar.tsx',
      'components/layout/Sidebar.tsx',
    ];
    for (const f of uiFiles) {
      // Strip block comments, line comments, and imports (including the
      // multi-line ones), then look at what is left for the word.
      const body = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^import [\s\S]*?from '[^']*';$/gm, '');
      // Code identifiers and the API path are deliberately unchanged: the word
      // survives in the codebase, just not in anything a user reads.
      const CODE = /\/api\/clearance|'\/clearance|"\/clearance|clearanceHref|clearanceArrival|clearance-(review|link|workflow)|Clearance(Search|Page|sTable)\b/;
      const offenders = body.split('\n').filter((l) => /clearance/i.test(l) && !CODE.test(l));
      expect(offenders, `${f}: ${offenders.join(' | ')}`).toEqual([]);
    }
  });
});

describe('a result opens exactly as a portfolio mark does', () => {
  // Not a lookalike. The same stylesheet, so the two cannot drift the first
  // time either is restyled.
  it('uses DetailPanel\'s own chrome', () => {
    expect(hitPanel).toContain("from '../detail/DetailPanel.module.css'");
    for (const cls of ['styles.overlay', 'styles.backdrop', 'styles.panel', 'styles.header', 'styles.body', 'styles.footer', 'styles.closeBtn']) {
      expect(hitPanel, cls).toContain(cls);
    }
  });

  it('sits beside the Bree panel when it is open, as DetailPanel does', () => {
    expect(hitPanel).toContain('breeOpen ? { right: 360 } : undefined');
  });

  it('steps through results from the panel header', () => {
    expect(hitPanel).toContain('aria-label="Previous result"');
    expect(hitPanel).toContain('aria-label="Next result"');
    expect(hitPanel).toMatch(/ArrowLeft/);
    expect(hitPanel).toMatch(/ArrowRight/);
  });

  // Opening a result must not disturb the list behind it.
  it('is an overlay on the frame, not a change to the list', () => {
    expect(page).toContain('<AppShell overlay={hitPanel}>');
    expect(page).not.toMatch(/openHit[^\n]*filter\(/);
  });
});

describe('button weight', () => {
  // Report and Settings set the level: outline. A filled button is a claim
  // about where the eye should go, and this feature does not make one.
  it('gives the two header actions the same outline style as Report and Settings', () => {
    const actions = topbar.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(actions.length).toBeGreaterThanOrEqual(4);
    expect(topbar).not.toContain('btnPrimary');
  });

  it('uses no filled button anywhere in the feature', () => {
    const files = ['app/clearance/page.tsx', ...readdirSync('components/clearance').map((f) => join('components/clearance', f))];
    for (const f of files) {
      expect(read(f), f).not.toMatch(/bg-slate-800|bg-ink\b|btnPrimary/);
    }
  });
});
