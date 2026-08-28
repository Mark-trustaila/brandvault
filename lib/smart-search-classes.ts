/**
 * Nice classes, in the one form the contract accepts.
 *
 * Its own module, with no env and no fetch, so the browser can import it
 * without pulling in lib/smart-search.ts — that module holds the facade keys
 * and must never reach a bundle. The form-side and the submit-side then
 * normalise identically, which is the point: a term typed as "25, 35" and one
 * arriving as ["25","35"] from a mark record are the same search.
 */

/**
 * Accepts what a person or a mark record actually offers — "35, 36", ["9"],
 * [9, 42] — and yields ["35","36"]. Deduped and sorted numerically so two
 * spellings of one request produce the same submission.
 *
 * Anything outside 1-45 is dropped rather than sent: the Nice classification
 * has 45 classes, so a 46 is a typo, and submitting it would narrow a search to
 * nothing while looking like it ran.
 */
export function normaliseClasses(input: unknown): string[] {
  const raw: unknown[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const seen = new Set<number>();
  for (const item of raw) {
    const n = Number(String(item ?? '').trim());
    if (!Number.isInteger(n) || n < 1 || n > 45) continue;
    seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b).map(String);
}
