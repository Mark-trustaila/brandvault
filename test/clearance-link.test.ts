/**
 * Both ends of the mark → clearance link, pinned together so a rename on one
 * side cannot quietly stop the other prefilling.
 */
import { describe, it, expect } from 'vitest';
import { clearanceHref, clearanceArrival } from '../lib/clearance-link';

const mark = (over: Record<string, unknown> = {}) => ({
  mark_text: 'ASOS',
  application_number: 'UK00002530115',
  good_and_services: [{ search_class: { number: 35 } }, { search_class: { number: 25 } }],
  ...over,
});

describe('clearanceHref', () => {
  it('carries the mark text, its classes in order, and its number as provenance', () => {
    expect(clearanceHref(mark() as any)).toBe('/clearance?term=ASOS&classes=25%2C35&mark_ref=UK00002530115');
  });

  it('round-trips through the reader', () => {
    const href = clearanceHref(mark() as any);
    const arrival = clearanceArrival(href.split('?')[1]);
    expect(arrival).toEqual({ searchId: null, term: 'ASOS', classes: ['25', '35'], markRef: 'UK00002530115' });
  });

  it('omits classes rather than sending an empty list', () => {
    expect(clearanceHref(mark({ good_and_services: [] }) as any)).toBe('/clearance?term=ASOS&mark_ref=UK00002530115');
  });

  // A device mark has no verbal element to text-match on. The link lands on an
  // empty form; it does not search for "" or for the application number.
  it('carries no term for a mark with no verbal element', () => {
    const href = clearanceHref(mark({ mark_text: '' }) as any);
    expect(href).not.toContain('term=');
    expect(clearanceArrival(href.split('?')[1] ?? '').term).toBe('');
  });

  it('handles a mark with nothing at all', () => {
    expect(clearanceHref({} as any)).toBe('/clearance');
  });
});

describe('clearanceArrival', () => {
  it('reads a search id, which takes precedence over a query to re-run', () => {
    const a = clearanceArrival('search=srch-1&term=ASOS');
    expect(a.searchId).toBe('srch-1');
    expect(a.term).toBe('ASOS');
  });

  it('normalises the classes it is given, however they were typed', () => {
    expect(clearanceArrival('classes=35%2C%2035%2C%209').classes).toEqual(['9', '35']);
  });

  it('is empty, not broken, on an empty query string', () => {
    expect(clearanceArrival('')).toEqual({ searchId: null, term: '', classes: [], markRef: null });
  });
});
