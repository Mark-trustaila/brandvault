import { describe, it, expect } from 'vitest';
import { deviceImageAlt } from '../lib/mark-tile';
import { DEVICE_IMAGES } from '../scripts/load-device-images';

describe('deviceImageAlt', () => {
  it('names the mark type and the application number', () => {
    expect(deviceImageAlt('UK00003834437')).toBe('device mark UK00003834437');
  });

  it('never returns an empty alt: the image IS the mark here', () => {
    expect(deviceImageAlt(undefined)).toBe('device mark');
    expect(deviceImageAlt('')).toBe('device mark');
  });
});

describe('device image mapping', () => {
  it('has all seven GB device marks', () => {
    expect(Object.keys(DEVICE_IMAGES)).toHaveLength(7);
  });

  it('stores URLs verbatim and never templates {appnum}.jpg', () => {
    // UK00002182599 carries a _1_0 suffix no template would produce. If this
    // ever equals the templated form, someone has replaced the mapping with a rule.
    expect(DEVICE_IMAGES.UK00002182599).toBe(
      'https://lawpanel-data.azureedge.net/images/GB/UK00002182599_1_0.jpg'
    );
    expect(DEVICE_IMAGES.UK00002182599).not.toBe(
      'https://lawpanel-data.azureedge.net/images/GB/UK00002182599.jpg'
    );
  });

  it('points every entry at the LawPanel CDN over https', () => {
    for (const [appNo, url] of Object.entries(DEVICE_IMAGES)) {
      expect(url, appNo).toMatch(/^https:\/\/lawpanel-data\.azureedge\.net\/images\/GB\//);
    }
  });
});
