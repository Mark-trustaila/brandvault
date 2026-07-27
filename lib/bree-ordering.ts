/**
 * Ordering for every multi-result Bree reply.
 *
 * One rule, one definition: **soonest governing deadline first, rights with no
 * upcoming deadline last.**
 *
 * Why this is a shared helper rather than an ORDER BY in each query: the reply
 * to `/bree status` was registry-alphabetical, so a UKIPO renewal 99 days out
 * sat sixth of ten rights while a deadline a decade away led the list. The
 * renewals list and the weekly digest were ordered correctly, but only because
 * each happened to sort by due date in its own SQL. Three incidental orderings
 * are three chances to drift apart, and the one that drifted is the one that
 * buries the most urgent obligation in the portfolio.
 *
 * A right with no upcoming deadline is not dropped. It is still part of a
 * truthful answer about the portfolio, so it goes to the end.
 *
 * Pure: no clock, no I/O. Callers pass the days-remaining they already
 * computed, so this never re-derives a date and cannot disagree with what the
 * reply renders.
 */

/** Sorts last: no upcoming deadline means nothing to be urgent about. */
const NO_DEADLINE = Number.POSITIVE_INFINITY;

/**
 * Sort key for one item. Anything that is not a finite number (null, undefined,
 * NaN) means "no upcoming deadline" and ranks last.
 *
 * Negative values are kept as-is and therefore sort first: an overdue
 * obligation outranks everything. The callers all filter to `dueDate >= now`,
 * so this should not arise, but ranking it first is the safe direction to be
 * wrong in.
 */
export function deadlineRank(days: number | null | undefined): number {
  return typeof days === 'number' && Number.isFinite(days) ? days : NO_DEADLINE;
}

/**
 * The soonest rank across a set of items, or NO_DEADLINE when none of them has
 * one. Used to order a group by its most urgent member.
 */
export function soonestRank<T>(items: readonly T[], daysOf: (item: T) => number | null | undefined): number {
  return items.reduce((min, item) => Math.min(min, deadlineRank(daysOf(item))), NO_DEADLINE);
}

/**
 * Order items by governing deadline, soonest first.
 *
 * Returns a new array; the input is not mutated. `Array.prototype.sort` is
 * stable, so items sharing a deadline (and the whole no-deadline tail) keep the
 * order the caller supplied. Callers hand over a deterministic base order
 * (registry-alphabetical), which makes ties break alphabetically and, more
 * importantly, makes the same portfolio always produce the same reply.
 */
export function orderByGoverningDeadline<T>(
  items: readonly T[],
  daysOf: (item: T) => number | null | undefined
): T[] {
  return items.slice().sort((a, b) => deadlineRank(daysOf(a)) - deadlineRank(daysOf(b)));
}
