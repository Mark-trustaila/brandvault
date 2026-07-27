import { describe, it, expect } from 'vitest';
import {
  dashboardSearchLink,
  breePanelLink,
  searchQueryFromUrl,
  panelOpenFromUrl,
  SEARCH_PARAM,
  PANEL_PARAM,
} from '../lib/deep-links';

const BASE = 'https://brandvault-asos.vercel.app';

describe('dashboardSearchLink', () => {
  it('targets the dashboard with the search param', () => {
    expect(dashboardSearchLink('TOPSHOP', BASE)).toBe(`${BASE}/?${SEARCH_PARAM}=TOPSHOP`);
  });

  // A mark name is user data: spaces, ampersands and slashes all occur.
  it('encodes a name with spaces', () => {
    expect(dashboardSearchLink('TOPSHOP UNIQUE', BASE)).toBe(`${BASE}/?q=TOPSHOP%20UNIQUE`);
  });

  it('encodes characters that would otherwise break the query string', () => {
    expect(dashboardSearchLink('A&B', BASE)).toBe(`${BASE}/?q=A%26B`);
    expect(dashboardSearchLink('A/B', BASE)).toBe(`${BASE}/?q=A%2FB`);
    expect(dashboardSearchLink('50% OFF', BASE)).toBe(`${BASE}/?q=50%25%20OFF`);
    expect(dashboardSearchLink('a?b=c', BASE)).toBe(`${BASE}/?q=a%3Fb%3Dc`);
  });

  it('round-trips through the reader, encoding included', () => {
    for (const name of ['TOPSHOP', 'TOPSHOP UNIQUE', 'A&B', '50% OFF', 'a?b=c', 'ASOS 4505']) {
      const url = new URL(dashboardSearchLink(name, BASE));
      expect(searchQueryFromUrl(url.search)).toBe(name);
    }
  });
});

describe('breePanelLink', () => {
  it('targets the dashboard with the panel param', () => {
    expect(breePanelLink(BASE)).toBe(`${BASE}/?${PANEL_PARAM}=1`);
  });

  it('round-trips through the reader', () => {
    expect(panelOpenFromUrl(new URL(breePanelLink(BASE)).search)).toBe(true);
  });

  it('does not carry a search, so it lands unfiltered', () => {
    expect(searchQueryFromUrl(new URL(breePanelLink(BASE)).search)).toBe('');
  });
});

describe('searchQueryFromUrl', () => {
  it('reads the query with or without the leading question mark', () => {
    expect(searchQueryFromUrl('?q=TOPSHOP')).toBe('TOPSHOP');
    expect(searchQueryFromUrl('q=TOPSHOP')).toBe('TOPSHOP');
  });

  it('decodes an encoded name', () => {
    expect(searchQueryFromUrl('?q=TOPSHOP%20UNIQUE')).toBe('TOPSHOP UNIQUE');
  });

  it('returns empty when absent, blank or whitespace only', () => {
    expect(searchQueryFromUrl('')).toBe('');
    expect(searchQueryFromUrl('?notification=abc')).toBe('');
    expect(searchQueryFromUrl('?q=')).toBe('');
    expect(searchQueryFromUrl('?q=%20%20')).toBe('');
  });

  it('ignores other params alongside it', () => {
    expect(searchQueryFromUrl('?bree=1&q=ASOS&x=y')).toBe('ASOS');
  });
});

describe('panelOpenFromUrl', () => {
  it('opens on the link we generate', () => {
    expect(panelOpenFromUrl('?bree=1')).toBe(true);
  });

  it('opens on a bare param', () => {
    expect(panelOpenFromUrl('?bree')).toBe(true);
  });

  // Someone editing a link by hand should get what the value says.
  it('stays closed when explicitly negated', () => {
    expect(panelOpenFromUrl('?bree=0')).toBe(false);
    expect(panelOpenFromUrl('?bree=false')).toBe(false);
    expect(panelOpenFromUrl('?bree=NO')).toBe(false);
  });

  it('stays closed when absent', () => {
    expect(panelOpenFromUrl('')).toBe(false);
    expect(panelOpenFromUrl('?q=TOPSHOP')).toBe(false);
  });

  // The two landings are independent: a search arrival must not open the panel.
  it('is unaffected by a search arrival', () => {
    expect(panelOpenFromUrl('?q=TOPSHOP')).toBe(false);
    expect(searchQueryFromUrl('?bree=1')).toBe('');
  });
});
