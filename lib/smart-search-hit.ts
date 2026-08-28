/**
 * Reading a Smart Search response for display: the shape of a hit, the two
 * fields you cannot read straight off it, and the one judgement the results
 * panel makes about the response as a whole.
 *
 * Its own module, env-free, so the browser can import the accessors without
 * pulling in lib/smart-search.ts and its keys. lib/smart-search.ts re-exports
 * the types, so a server-side caller still needs one import.
 *
 * Why accessors at all. §3.2 says the facade returns "the §2.3 hits normalised:
 * registry as a name not a code, application_date as a date, and the raw
 * upstream fields preserved". The deployed facade reads "preserved" as
 * "preserved under a `raw` key" and normalises further than the two changes
 * §3.2 names: `mark_string` becomes `mark`, the comma string `classes` becomes
 * an array, `class_match` becomes a boolean, and the top-level `id` goes.
 *
 * Both readings are defensible and the argument is not worth a synchronisation
 * point. `raw` carries the §2.3 shape intact, so a client that accepts either
 * form is correct whichever way the facade settles — and stays correct if it
 * changes its mind. That tolerance lives here, in two functions, rather than
 * spread across the panel.
 */

/** The upstream hit, §2.3, verbatim. What the facade nests under `raw`. */
export interface RawSmartSearchHit {
  id: string;
  score: number;
  similarity: string | null;
  /** 1 or 0 upstream. */
  class_match: number;
  application_number: string;
  /** Comma string upstream, e.g. "2,9,16,20,35". */
  classes: string;
  status: string;
  mark_string: string;
  /** Integer code as a string upstream, e.g. "112" for UKIPO. */
  registry: string;
  registry_official_name?: string;
  is_registered?: boolean;
  application_date: string | null;
  owner: string | null;
  mark_id?: number;
}

/**
 * One hit as the facade serves it. Declared to the live wire, with §2.3's forms
 * tolerated where they differ — hence the unions on `classes` and the optional
 * `mark_string`. Read `mark` and `classes` through the accessors below rather
 * than directly.
 */
export interface SmartSearchHit {
  /** Absent on the live wire; `raw.id` carries it. */
  id?: string;
  score: number;
  similarity: string | null;
  /** Boolean on the live wire, 1/0 in §2.3. Both are truthy-safe. */
  class_match: boolean | number;
  application_number: string;
  /** Array on the live wire, comma string in §2.3. */
  classes: string[] | string;
  status: string;
  /** The live wire's name for the mark text. */
  mark?: string;
  /** §2.3's name for the same thing, if a facade ever sends it flat. */
  mark_string?: string;
  registry: string;
  registry_official_name?: string;
  is_registered?: boolean;
  application_date: string | null;
  owner: string | null;
  mark_id?: number;
  /** The verbatim upstream hit, preserved by the facade. */
  raw?: RawSmartSearchHit;
}

/**
 * The mark text, from wherever this facade put it.
 *
 * Empty string when there is none, so a caller can fall back with `||` — never
 * the literal "undefined", which is what reading `mark_string` off the live
 * wire produced on all 206 rows of the first live search.
 */
export function hitMarkText(hit: SmartSearchHit): string {
  return (hit.mark ?? hit.mark_string ?? hit.raw?.mark_string ?? '').trim();
}

/**
 * The hit's classes, as a list, from either form.
 *
 * Not routed through normaliseClasses: that one drops anything outside 1-45 and
 * sorts, which is right for a search we are about to submit and wrong for a
 * registry record we are displaying. What the register holds is what the reader
 * should see, in the order it was given.
 */
export function hitClasses(hit: SmartSearchHit): string[] {
  const raw = hit.classes ?? hit.raw?.classes;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return list.map((c) => String(c).trim()).filter(Boolean);
}

/** The classes as one readable string. "3, 9, 25" — never a run-together "3925". */
export function hitClassesLabel(hit: SmartSearchHit): string {
  return hitClasses(hit).join(', ');
}

/**
 * What the panel must warn about before showing a capped list, or null when
 * there is nothing to warn about.
 *
 * A decision, not a component, so "truncated renders the notice" and "not
 * truncated renders none" are pinned by a test rather than by reading JSX. The
 * component is the thin part.
 *
 * Two shapes, because there are two different truths to tell.
 *
 *   known   — the facade capped a result set it had counted. We can say
 *             "250 of 4,318", and the reader knows exactly what is missing.
 *   unknown — upstream capped it first. LawPanel returns at most `upstream_cap`
 *             hits and never says how many it had, so `total_available` comes
 *             back null and the total is genuinely unknowable. All that can be
 *             said honestly is "at least this many, and more than we can see".
 *
 * The distinction is the whole point. Rendering `result_count` as a total when
 * the total is unknown turns "we could not see the rest" into "there is no
 * rest", which is a false clear stated with a number attached — worse than the
 * silence it replaced, because a number reads as a finding.
 *
 * Null unless `truncated` is exactly true. A facade that stops sending the
 * field, or sends something truthy but not true, must not quietly start
 * presenting a capped list as a complete search of the register.
 */
export type TruncationNotice =
  | { kind: 'known'; shown: number; total: number; cap: number | null }
  | { kind: 'unknown'; shown: number; atLeast: number | null; upstreamCap: number | null };

export function truncationNotice(result: {
  truncated?: boolean;
  result_count?: number | null;
  total_available?: number | null;
  total_at_least?: number | null;
  upstream_cap?: number | null;
  cap?: number | null;
  results?: unknown[] | null;
}): TruncationNotice | null {
  if (result.truncated !== true) return null;
  const shown = result.result_count ?? result.results?.length ?? 0;
  const total = result.total_available;
  if (typeof total === 'number') {
    return { kind: 'known', shown, total, cap: result.cap ?? null };
  }
  return {
    kind: 'unknown',
    shown,
    atLeast: result.total_at_least ?? null,
    upstreamCap: result.upstream_cap ?? null,
  };
}
