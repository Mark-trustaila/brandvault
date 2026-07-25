import { describe, it, expect } from 'vitest';
import {
  anchorWatchNotice,
  overlappingClasses,
  daysToOpposition,
  normaliseRef,
  overlapSentence,
  oppositionLabel,
  type PortfolioMark,
} from '../lib/watch-notices';
import { watchNoticeAlert } from '../lib/bree-messages';
import type { WatchNoticeDetails } from '../lib/email-types';

const NOW = new Date('2026-07-25T00:00:00.000Z');

const PORTFOLIO: PortfolioMark[] = [
  { id: 'tm-anchor', applicationNumber: 'UK00002530115', markText: 'ASOS' },
  { id: 'tm-other', applicationNumber: 'UK00003190037', markText: 'LOOPED' },
  { id: 'tm-noappno', applicationNumber: null, markText: 'NO NUMBER' },
];

const FIXTURE: WatchNoticeDetails = {
  thirdPartyMarkText: 'Assos',
  thirdPartyApplicationNumber: 'UK00004437218',
  thirdPartyClasses: [18, 25],
  filingDate: '2026-05-12',
  publicationDate: '2026-06-26',
  oppositionDeadline: '2026-08-26',
  citedMarkReferences: ['UK00002530115'],
};

describe('anchorWatchNotice', () => {
  it('anchors to the cited mark', () => {
    const r = anchorWatchNotice(FIXTURE, PORTFOLIO);
    expect(r.anchored).toHaveLength(1);
    expect(r.anchored[0].trademarkId).toBe('tm-anchor');
    expect(r.anchored[0].thirdPartyMarkText).toBe('Assos');
    expect(r.anchored[0].thirdPartyApplicationNumber).toBe('UK00004437218');
    expect(r.anchored[0].thirdPartyClasses).toEqual([18, 25]);
    expect(r.anchored[0].oppositionDeadline).toEqual(new Date('2026-08-26'));
    expect(r.unmatchedReferences).toEqual([]);
    expect(r.skippedReason).toBeNull();
  });

  it('creates one notice per cited mark when several are cited', () => {
    const r = anchorWatchNotice(
      { ...FIXTURE, citedMarkReferences: ['UK00002530115', 'UK00003190037'] },
      PORTFOLIO
    );
    expect(r.anchored.map((a) => a.trademarkId)).toEqual(['tm-anchor', 'tm-other']);
  });

  it('routes an unmatched reference out rather than guessing', () => {
    const r = anchorWatchNotice({ ...FIXTURE, citedMarkReferences: ['UK00009999999'] }, PORTFOLIO);
    expect(r.anchored).toEqual([]);
    expect(r.unmatchedReferences).toEqual(['UK00009999999']);
    expect(r.skippedReason).toBeNull();
  });

  it('keeps the matched ones and reports the unmatched ones together', () => {
    const r = anchorWatchNotice(
      { ...FIXTURE, citedMarkReferences: ['UK00002530115', 'UK00009999999'] },
      PORTFOLIO
    );
    expect(r.anchored).toHaveLength(1);
    expect(r.unmatchedReferences).toEqual(['UK00009999999']);
  });

  it('NEVER matches by mark text', () => {
    // The third party's mark is one character from ours and our mark text is
    // quoted in the letter. Without a cited number, nothing is anchored.
    const r = anchorWatchNotice(
      { ...FIXTURE, thirdPartyMarkText: 'ASOS', citedMarkReferences: [] },
      PORTFOLIO
    );
    expect(r.anchored).toEqual([]);
    expect(r.skippedReason).toBe('no-cited-references');
  });

  it('tolerates spacing and case differences in a quoted number', () => {
    const r = anchorWatchNotice({ ...FIXTURE, citedMarkReferences: ['uk 00002530115'] }, PORTFOLIO);
    expect(r.anchored[0]?.trademarkId).toBe('tm-anchor');
  });

  it('does not create two notices when one right is cited twice', () => {
    const r = anchorWatchNotice(
      { ...FIXTURE, citedMarkReferences: ['UK00002530115', 'UK 00002530115'] },
      PORTFOLIO
    );
    expect(r.anchored).toHaveLength(1);
  });

  it('skips when the third party application cannot be identified', () => {
    expect(anchorWatchNotice({ ...FIXTURE, thirdPartyApplicationNumber: null }, PORTFOLIO).skippedReason)
      .toBe('no-third-party-application-number');
    expect(anchorWatchNotice({ ...FIXTURE, thirdPartyMarkText: null }, PORTFOLIO).skippedReason)
      .toBe('no-third-party-mark-text');
  });

  it('handles a missing details block', () => {
    expect(anchorWatchNotice(null, PORTFOLIO).anchored).toEqual([]);
    expect(anchorWatchNotice(undefined, PORTFOLIO).anchored).toEqual([]);
  });

  it('treats an absent opposition deadline as not stated, not as a default', () => {
    const r = anchorWatchNotice({ ...FIXTURE, oppositionDeadline: null }, PORTFOLIO);
    expect(r.anchored[0].oppositionDeadline).toBeNull();
  });

  it('normalises references consistently', () => {
    expect(normaliseRef('uk 00002530115')).toBe('UK00002530115');
    expect(normaliseRef('UK-000/02530115')).toBe('UK00002530115');
  });
});

describe('overlappingClasses', () => {
  it('is a plain set intersection', () => {
    // The fixture: our anchor covers 3,8,9,11,14,18,21,26,35,36; theirs 18,25.
    expect(overlappingClasses([3, 8, 9, 11, 14, 18, 21, 26, 35, 36], [18, 25])).toEqual([18]);
  });

  it('returns nothing when the classes do not meet', () => {
    expect(overlappingClasses([3, 9], [18, 25])).toEqual([]);
  });

  it('deduplicates and sorts', () => {
    expect(overlappingClasses([25, 18, 18], [18, 25])).toEqual([18, 25]);
  });

  it('never invents a related class', () => {
    // 24 (textiles) is commercially adjacent to 25 (clothing). Not our call.
    expect(overlappingClasses([24], [25])).toEqual([]);
  });
});

describe('daysToOpposition', () => {
  it('counts whole days', () => {
    expect(daysToOpposition(new Date('2026-08-26T00:00:00Z'), NOW)).toBe(32);
  });
  it('is null when the deadline is not stated', () => {
    expect(daysToOpposition(null, NOW)).toBeNull();
  });
});

describe('watchNoticeAlert', () => {
  const alert = watchNoticeAlert({
    thirdPartyMarkText: 'Assos',
    thirdPartyApplicationNumber: 'UK00004437218',
    registry: 'UKIPO',
    classes: [18, 25],
    ourMarkText: 'ASOS',
    ourApplicationNumber: 'UK00002530115',
    oppositionDeadline: '2026-08-26',
    daysToOpposition: 32,
    appLink: 'https://brandvault-asos.vercel.app/watch/abc',
  });
  const body = JSON.stringify(alert);

  it('names both marks with both application numbers', () => {
    expect(body).toContain('UK00004437218');
    expect(body).toContain('UK00002530115');
    expect(body).toContain('Assos');
    expect(body).toContain('ASOS');
  });

  it('states the classes and the opposition window', () => {
    expect(body).toContain('classes 18, 25');
    expect(body).toContain('2026-08-26');
    expect(body).toContain('32 days');
  });

  it('carries the deep link', () => {
    expect(body).toContain('See in app');
  });

  it('contains no em dash', () => {
    expect(body).not.toContain('—');
  });

  it('omits the opposition line entirely when no deadline is stated', () => {
    const noDeadline = JSON.stringify(
      watchNoticeAlert({
        thirdPartyMarkText: 'Assos',
        thirdPartyApplicationNumber: 'UK00004437218',
        registry: 'UKIPO',
        classes: [18],
        ourMarkText: 'ASOS',
        ourApplicationNumber: 'UK00002530115',
        oppositionDeadline: null,
      })
    );
    expect(noDeadline).not.toContain('Opposition period ends');
  });

  it('says so when the notice states no classes', () => {
    const noClasses = JSON.stringify(
      watchNoticeAlert({
        thirdPartyMarkText: 'Assos',
        thirdPartyApplicationNumber: 'UK00004437218',
        registry: 'UKIPO',
        classes: [],
        ourMarkText: 'ASOS',
        ourApplicationNumber: 'UK00002530115',
      })
    );
    expect(noClasses).toContain('classes not stated');
  });
});

describe('comparison view text (pure)', () => {
  it('states a single overlapping class', () => {
    expect(overlapSentence([18])).toBe('Both marks are filed in class 18.');
  });

  it('states several overlapping classes', () => {
    expect(overlapSentence([18, 25])).toBe('Both marks are filed in classes 18, 25.');
  });

  it('says plainly when there is no overlap', () => {
    expect(overlapSentence([])).toBe('The two filings share no class.');
  });

  it('never characterises the overlap as similarity or risk', () => {
    const text = [overlapSentence([18]), overlapSentence([])].join(' ').toLowerCase();
    for (const banned of ['similar', 'score', 'confusion', 'likelihood', 'recommend', 'risk']) {
      expect(text, banned).not.toContain(banned);
    }
  });

  it('labels the opposition countdown', () => {
    expect(oppositionLabel(32)).toBe('32 days remaining');
    expect(oppositionLabel(0)).toBe('0 days remaining');
    expect(oppositionLabel(-3)).toBe('closed 3 days ago');
    expect(oppositionLabel(null)).toBeNull();
  });
});
