import { describe, it, expect } from 'vitest';
import { changelogEntries, formatEntryDate } from '../lib/changelog';
import { feedback } from '../lib/bree-messages';

describe('changelogEntries', () => {
  const entries = changelogEntries();

  it('returns entries newest first', () => {
    const dates = entries.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('gives every entry a date, a title and a body', () => {
    for (const e of entries) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.body.length).toBeGreaterThan(0);
    }
  });

  // Copy rules for the changelog: plain sentences, no em dashes, and none of
  // the vocabulary that reads as filler. Asserted so a later entry cannot
  // quietly drift back into it.
  it('uses no em dashes', () => {
    for (const e of entries) {
      expect(`${e.title} ${e.body}`).not.toContain('—');
    }
  });

  it('avoids filler vocabulary', () => {
    const banned = [
      'seamless', 'seamlessly', 'robust', 'powerful', 'leverage', 'streamline',
      'delight', 'unlock', 'effortless', 'game-changing', 'revolutionise',
      'revolutionize', 'cutting-edge', 'best-in-class', 'elevate', 'supercharge',
    ];
    for (const e of entries) {
      const text = `${e.title} ${e.body}`.toLowerCase();
      for (const word of banned) expect(text).not.toContain(word);
    }
  });
});

describe('formatEntryDate', () => {
  it('formats an ISO date for display', () => {
    expect(formatEntryDate('2026-07-25')).toBe('25 July 2026');
    expect(formatEntryDate('2026-07-06')).toBe('6 July 2026');
  });

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(formatEntryDate('not-a-date')).toBe('not-a-date');
  });
});

describe('feedback message', () => {
  const msg = feedback({ companyName: 'ASOS plc', userName: 'Mark Kingsley-Williams', text: 'The renewal list should sort by date.' });

  it('names the person and the company in the fallback text', () => {
    expect(msg.text).toContain('Mark Kingsley-Williams');
    expect(msg.text).toContain('ASOS plc');
  });

  it('quotes the submitted text verbatim', () => {
    expect(JSON.stringify(msg.blocks)).toContain('The renewal list should sort by date.');
  });

  it('quotes every line, so a multi-line message stays inside the quote', () => {
    const multi = feedback({ companyName: 'ASOS plc', userName: 'Mark', text: 'first line\nsecond line' });
    const block = JSON.stringify(multi.blocks);
    expect(block).toContain('> first line');
    expect(block).toContain('> second line');
  });

  it('is signed as Bree like every other message', () => {
    expect(JSON.stringify(msg.blocks)).toContain('Bree · BrandVault');
  });
});
