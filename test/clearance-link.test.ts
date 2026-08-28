/**
 * Both ends of the mark → clearance link, pinned together so a rename on one
 * side cannot quietly stop the other prefilling.
 */
import { describe, it, expect } from 'vitest';
import { clearanceHref, clearanceArrival } from '../lib/clearance-link';
import { DEFAULT_REGISTRY } from '../lib/smart-search-registries';

const mark = (over: Record<string, unknown> = {}) => ({
  mark_text: 'ASOS',
  application_number: 'UK00002530115',
  registry_name: 'UKIPO',
  good_and_services: [{ search_class: { number: 35 } }, { search_class: { number: 25 } }],
  ...over,
});

describe('clearanceHref', () => {
  it('carries the mark text, its classes in order, and its number as provenance', () => {
    expect(clearanceHref(mark() as any)).toBe('/clearance?term=ASOS&classes=25%2C35&mark_ref=UK00002530115&registry=gb');
  });

  it('round-trips through the reader', () => {
    const href = clearanceHref(mark() as any);
    const arrival = clearanceArrival(href.split('?')[1]);
    expect(arrival).toEqual({ searchId: null, term: 'ASOS', classes: ['25', '35'], markRef: 'UK00002530115', registry: 'gb' });
  });

  it('omits classes rather than sending an empty list', () => {
    expect(clearanceHref(mark({ good_and_services: [] }) as any)).toBe('/clearance?term=ASOS&mark_ref=UK00002530115&registry=gb');
  });

  // A device mark has no verbal element to text-match on. The link lands on an
  // empty form; it does not search for "" or for the application number.
  it('carries no term for a mark with no verbal element', () => {
    const href = clearanceHref(mark({ mark_text: '' }) as any);
    expect(href).not.toContain('term=');
    expect(clearanceArrival(href.split('?')[1] ?? '').term).toBe('');
  });

  // The register is always written, even when nothing else is: a link that
  // names no register leaves the page to a default, and which register was
  // searched is the one thing a clearance result cannot be read without.
  it('names a register even for a mark with nothing else', () => {
    expect(clearanceHref({} as any)).toBe(`/clearance?registry=${DEFAULT_REGISTRY}`);
  });

  it('takes the mark\'s own register when it is one we can search', () => {
    expect(clearanceHref(mark({ registry_name: 'WIPO' }) as any)).toContain('registry=wo');
    expect(clearanceHref(mark({ registry_name: 'UKIPO' }) as any)).toContain('registry=gb');
  });

  // EUIPO and USPTO both appear in real portfolios and neither is searchable
  // yet. Proposing GB beats refusing the action, and is only safe because the
  // page displays the register it is about to search.
  it('falls back to GB for a register we cannot search yet', () => {
    expect(clearanceHref(mark({ registry_name: 'EUIPO' }) as any)).toContain('registry=gb');
    expect(clearanceHref(mark({ registry_name: 'USPTO' }) as any)).toContain('registry=gb');
  });

  it('lets the caller override the mark\'s register', () => {
    expect(clearanceHref(mark() as any, 'wo')).toContain('registry=wo');
  });
});

describe('clearanceArrival', () => {
  // Links written before the register was selectable carry no registry param.
  // They always searched GB, so landing on GB keeps them meaning what they meant.
  it('reads a link written before the register was selectable as GB', () => {
    expect(clearanceArrival('term=ASOS&classes=25').registry).toBe('gb');
  });

  it('reads the register when the link names one', () => {
    expect(clearanceArrival('term=ASOS&registry=wo').registry).toBe('wo');
    expect(clearanceArrival('term=ASOS&registry=WO').registry).toBe('wo');
  });

  it('falls back to GB rather than passing on a register that does not exist', () => {
    expect(clearanceArrival('term=ASOS&registry=eu').registry).toBe('gb');
    expect(clearanceArrival('term=ASOS&registry=nonsense').registry).toBe('gb');
  });

  it('reads a search id, which takes precedence over a query to re-run', () => {
    const a = clearanceArrival('search=srch-1&term=ASOS');
    expect(a.searchId).toBe('srch-1');
    expect(a.term).toBe('ASOS');
  });

  it('normalises the classes it is given, however they were typed', () => {
    expect(clearanceArrival('classes=35%2C%2035%2C%209').classes).toEqual(['9', '35']);
  });

  it('is empty, not broken, on an empty query string', () => {
    expect(clearanceArrival('')).toEqual({ searchId: null, term: '', classes: [], markRef: null, registry: 'gb' });
  });
});
