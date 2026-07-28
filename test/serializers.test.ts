import { describe, it, expect } from 'vitest';
import { serializeTrademarkListItem, serializeTrademark, serializeNote, serializeAudit } from '../lib/serializers';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('serializeTrademark', () => {
  const mark = {
    id: 't1', registryName: 'UKIPO', markText: 'ASOS', applicationNumber: 'UK1',
    registrationNumber: null, status: 'Registered',
    filingDate: new Date('2020-01-01'), registrationDate: null, expiryDate: null, publicationDate: null,
    clientAgentName: null, companyId: 'c1', familyId: null, createdAt: new Date(), updatedAt: new Date(),
    goodsServices: [{ id: 'g1', trademarkId: 't1', classNumber: 25, text: 'Clothing' }],
  } as any;

  it('maps DB fields to the dashboard shape', () => {
    const s = serializeTrademark(mark);
    expect(s.registry_name).toBe('UKIPO');
    expect(s.mark_text).toBe('ASOS');
    expect(s.application_number).toBe('UK1');
    expect(s.registration_number).toBeUndefined();
    expect(s.filing_date).toBe('2020-01-01T00:00:00.000Z');
    expect(s.good_and_services[0]).toEqual({ search_class: { number: 25 }, text: 'Clothing' });
  });
});

describe('serializeNote', () => {
  const note = {
    id: 'n1', trademarkId: 't1', userId: 'u1', text: '<b>hi</b>', html: null, link: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    user: { name: 'Mark Kingsley-Williams' },
  } as any;

  it('derives author initials and full name', () => {
    const s = serializeNote(note);
    expect(s.author).toBe('MK');
    expect(s.authorFull).toBe('Mark Kingsley-Williams');
    expect(s.date).toBe('2026-01-01T00:00:00.000Z');
  });

  it('falls back to Unknown when there is no user', () => {
    expect(serializeNote({ ...note, user: null }).authorFull).toBe('Unknown');
  });
});

describe('serializeAudit', () => {
  const base = {
    id: 'a1', action: 'trademark.update', entityType: 'Trademark', entityId: 't1',
    reason: 'fix date', detailJson: null, createdAt: new Date('2026-01-01'),
  };

  it('shows platform-admin actions as "BrandVault Support"', () => {
    const s = serializeAudit({ ...base, isPlatformAdmin: true, user: { name: 'Mark' } } as any);
    expect(s.actor).toBe('BrandVault Support');
    expect(s.reason).toBe('fix date');
  });

  it('shows the user name for customer actions', () => {
    const s = serializeAudit({ ...base, isPlatformAdmin: false, user: { name: 'Jane Doe' } } as any);
    expect(s.actor).toBe('Jane Doe');
  });

  it('falls back to Unknown when there is no user', () => {
    const s = serializeAudit({ ...base, isPlatformAdmin: false, user: null } as any);
    expect(s.actor).toBe('Unknown');
  });
});

describe('serializeTrademarkListItem', () => {
  const row = {
    id: 't1', registryName: 'UKIPO', markText: 'ASOS', applicationNumber: 'UK1',
    registrationNumber: null, status: 'Registered',
    filingDate: new Date('2020-01-01'), registrationDate: null, expiryDate: null, publicationDate: null,
    clientAgentName: null, companyId: 'c1', familyId: null, createdAt: new Date(), updatedAt: new Date(),
    goodsServices: [{ classNumber: 25 }, { classNumber: 35 }],
  } as any;

  it('keeps class numbers, which the list actually uses', () => {
    expect(serializeTrademarkListItem(row).good_and_services).toEqual([
      { search_class: { number: 25 } },
      { search_class: { number: 35 } },
    ]);
  });

  // The 3.0MB the HAR measured was specification prose the list never renders.
  it('omits the specification text', () => {
    for (const g of serializeTrademarkListItem(row).good_and_services) {
      expect('text' in g).toBe(false);
    }
  });

  it('carries every other field the list needs', () => {
    const s = serializeTrademarkListItem(row);
    expect(s.mark_text).toBe('ASOS');
    expect(s.registry_name).toBe('UKIPO');
    expect(s.status).toBe('Registered');
    expect(s.filing_date).toBe('2020-01-01T00:00:00.000Z');
  });
});
