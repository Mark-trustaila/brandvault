/**
 * Which register a clearance search runs against.
 *
 * The registry was always meant to be selectable — the TMD reference UI carries
 * the choice, §3.1 makes it a path parameter, and the facade allows gb and wo.
 * It was hardcoded to gb only because the session brief's example said gb.
 *
 * What these pin is that the default is visible and the fallbacks are safe. A
 * clearance result read against the wrong register is a false clear, and a
 * false clear is the one wrong answer in clearance nobody catches.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  REGISTRIES, DEFAULT_REGISTRY, isRegistryCode, normaliseRegistry,
  registryLabel, registryInProse, registryForMark,
} from '../lib/smart-search-registries';

describe('the list', () => {
  it('is the two the facade allows, gb first', () => {
    expect(REGISTRIES.map((r) => r.code)).toEqual(['gb', 'wo']);
  });

  it('gives every register a label and a form that reads in a sentence', () => {
    for (const r of REGISTRIES) {
      expect(r.label.length).toBeGreaterThan(3);
      expect(r.inProse.startsWith('the ')).toBe(true);
    }
  });
});

describe('the default', () => {
  // The selector's initial value. UK-first product, and the register the facade
  // serves best — but a default the user can see and change, never an
  // assumption made on their behalf.
  it('is GB', () => {
    expect(DEFAULT_REGISTRY).toBe('gb');
  });

  it('is what the page initialises the selector to', () => {
    const src = readFileSync('app/clearance/page.tsx', 'utf8');
    expect(src).toContain('useState<RegistryCode>(DEFAULT_REGISTRY)');
  });

  // Visible, not implied: the search cannot run against a register the user was
  // never shown.
  it('is rendered as a labelled control on the page', () => {
    const src = readFileSync('app/clearance/page.tsx', 'utf8');
    expect(src).toContain('aria-label="Register to search"');
    expect(src).toContain('REGISTRIES.map');
  });
});

describe('normaliseRegistry', () => {
  it('accepts either case', () => {
    expect(normaliseRegistry('wo')).toBe('wo');
    expect(normaliseRegistry('WO')).toBe('wo');
    expect(normaliseRegistry(' Gb ')).toBe('gb');
  });

  // Never throws: a bad code is a typo or an old link, not an outage.
  it('falls back to the default rather than passing on nonsense', () => {
    expect(normaliseRegistry('eu')).toBe(DEFAULT_REGISTRY);
    expect(normaliseRegistry(undefined)).toBe(DEFAULT_REGISTRY);
    expect(normaliseRegistry(42)).toBe(DEFAULT_REGISTRY);
  });

  it('agrees with isRegistryCode', () => {
    expect(isRegistryCode('gb')).toBe(true);
    expect(isRegistryCode('eu')).toBe(false);
  });
});

describe('naming the register', () => {
  it('labels a control', () => {
    expect(registryLabel('gb')).toBe('UK register (UKIPO)');
    expect(registryLabel('wo')).toBe('Madrid register (WIPO)');
  });

  it('reads inside a sentence', () => {
    expect(`Searching ${registryInProse('gb')}`).toBe('Searching the UK register');
    expect(`Searching ${registryInProse('wo')}`).toBe('Searching the Madrid register');
  });

  it('names the default rather than nothing when the code is missing', () => {
    expect(registryLabel(undefined)).toBe(registryLabel(DEFAULT_REGISTRY));
  });
});

describe('registryForMark', () => {
  it('sends a Madrid mark to WO', () => {
    expect(registryForMark('WIPO')).toBe('wo');
    expect(registryForMark('wipo')).toBe('wo');
  });

  it('sends a UK mark to GB', () => {
    expect(registryForMark('UKIPO')).toBe('gb');
    expect(registryForMark('GB')).toBe('gb');
  });

  // EUIPO and USPTO are both in real portfolios and neither is searchable yet.
  // Proposing GB beats refusing the action — safe only because the selector
  // shows what was chosen before the user runs it.
  it('proposes GB for a register we cannot search yet', () => {
    expect(registryForMark('EUIPO')).toBe('gb');
    expect(registryForMark('USPTO')).toBe('gb');
    expect(registryForMark(null)).toBe('gb');
  });
});

describe('the panel names the register it searched', () => {
  const src = readFileSync('components/clearance/ResultsPanel.tsx', 'utf8');

  // Every outcome, not just the happy one. "The register was not searched" is
  // the sentence that matters most, and it has to say which.
  it('names it in the header and in all four outcomes', () => {
    expect(src).toContain('registryLabel(result.registry)');            // results header
    expect(src.match(/registryInProse\(result\.registry\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('no longer says a bare "the register" anywhere', () => {
    expect(src).not.toMatch(/>\s*The register was/);
    expect(src).not.toContain('This is not the whole register');
    expect(src).not.toContain('Searching the register<');
  });
});
