/**
 * Which registers a clearance search can be run against, and what to call them.
 *
 * Env-free, so the page, the panel and the link module share one list. The
 * server route keeps its own guard — a client-side list is a convenience, never
 * a gate.
 *
 * GB and WO to start, which is what the facade allows (`/smart-search/health`
 * reports `allowed: ["gb","wo"]`) and what §3.1 names. The contract makes
 * registry a path parameter precisely so this list can grow without the URLs
 * changing, so adding EU here later is a one-line change plus whatever the
 * facade has learned to serve.
 */

export const REGISTRIES = [
  { code: 'gb', label: 'UK register (UKIPO)', inProse: 'the UK register' },
  { code: 'wo', label: 'Madrid register (WIPO)', inProse: 'the Madrid register' },
] as const;

export type RegistryCode = (typeof REGISTRIES)[number]['code'];

/**
 * GB, because the product is UK-first and the GB corpus is the one the facade
 * serves best. A default, not an assumption — the selector shows it, so a
 * search never runs against a register the user did not see named.
 */
export const DEFAULT_REGISTRY: RegistryCode = 'gb';

export function isRegistryCode(value: unknown): value is RegistryCode {
  return typeof value === 'string' && REGISTRIES.some((r) => r.code === value.toLowerCase());
}

/** A registry code, or the default. Never throws — a bad value is a typo, not an outage. */
export function normaliseRegistry(value: unknown): RegistryCode {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isRegistryCode(v) ? (v as RegistryCode) : DEFAULT_REGISTRY;
}

/** For a dropdown or a heading: "UK register (UKIPO)". */
export function registryLabel(code: unknown): string {
  const c = normaliseRegistry(code);
  return REGISTRIES.find((r) => r.code === c)!.label;
}

/** For a sentence: "…nothing here says whether ASOS is clear in the UK register". */
export function registryInProse(code: unknown): string {
  const c = normaliseRegistry(code);
  return REGISTRIES.find((r) => r.code === c)!.inProse;
}

/**
 * The register a mark's own filing suggests searching.
 *
 * UKIPO and WIPO map to the two we can search. Everything else — EUIPO and
 * USPTO both appear in real portfolios — falls back to GB, because those
 * registers are not searchable yet and refusing the action would be worse than
 * proposing a sensible starting point. The fallback is safe only because the
 * selector displays what was chosen: the user sees "UK register" and can change
 * it before running. A prefill that silently searched the wrong register would
 * be a false clear.
 */
export function registryForMark(registryName: string | null | undefined): RegistryCode {
  const name = (registryName ?? '').trim().toUpperCase();
  if (name === 'WIPO' || name === 'WO' || name.startsWith('MADRID')) return 'wo';
  return DEFAULT_REGISTRY;
}

/**
 * Where to read this mark on the register's own site.
 *
 * Offered because a clearance decision often ends with someone checking the
 * official record themselves, and a link they can follow is worth more than a
 * number they have to paste. Null when we have no reliable URL shape for the
 * register — an outbound link that lands on a search page or an error is worse
 * than no link, because it looks like the record was checked.
 */
export function registerDeepLink(registry: unknown, applicationNumber: string): string | null {
  const code = normaliseRegistry(registry);
  const ref = (applicationNumber ?? '').trim();
  if (!ref) return null;
  if (code === 'gb') {
    return `https://trademarks.ipo.gov.uk/ipo-tmcase/page/Results/1/${encodeURIComponent(ref)}`;
  }
  // WIPO's Madrid Monitor keys on the international registration number, which
  // is not the application number the hit carries. Rather than guess a URL that
  // may 404, send the reader to the search with nothing pre-filled.
  return 'https://www3.wipo.int/madrid/monitor/en/';
}
