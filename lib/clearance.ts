/**
 * The clearance search record: writing one, listing them, reading one back,
 * and recording judgement on its hits (docs/clearance-workflow.md §3).
 *
 * Server-side. Every query is company-scoped — an id alone is never enough to
 * read or write a record, because ids are guessable and a clearance search
 * names a customer's commercial intentions.
 *
 * The snapshot rule is enforced here rather than trusted: nothing in this
 * module ever updates `hits`. Review writes go to ClearanceHitReview, so the
 * evidence of what the register said on the day cannot be edited by someone
 * changing their mind about a row.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { normaliseRegistry } from './smart-search-registries';
import { DEFAULT_TIER, isTier, type HistoryRow, type Tier } from './clearance-review';
import type { SmartSearchHit, SmartSearchResult } from './smart-search';

const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

export type SavedSearch = {
  id: string;
  searchId: string;
  term: string;
  classes: string[];
  registry: string;
  markRef: string | null;
  currencyDate: string | null;
  coverage: unknown;
  resultCount: number | null;
  totalAvailable: number | null;
  totalAtLeast: number | null;
  upstreamCap: number | null;
  truncated: boolean;
  status: string;
  failureReason: string | null;
  hits: SmartSearchHit[];
  rerunOfId: string | null;
  runBy: string | null;
  runAt: string;
};

/**
 * Persist a settled search. Completed and failed are both records: a failure is
 * evidence that the register was asked and did not answer, which is exactly
 * what someone re-running the search a week later needs to know.
 *
 * A still-running result is refused — a record with no outcome would appear in
 * the history as a search that was never answered, and nothing distinguishes
 * that from one that failed.
 */
export async function saveSearch(args: {
  companyId: string;
  runBy: string | null;
  result: SmartSearchResult;
  markRef?: string | null;
  rerunOfId?: string | null;
}): Promise<{ id: string }> {
  const { result } = args;
  if (result.status === 'running') {
    throw new Error('refusing to save a search that has not settled');
  }
  const row = await prisma.clearanceSearch.create({
    data: {
      companyId: args.companyId,
      searchId: result.search_id,
      term: result.term,
      classes: asJson(result.classes ?? []),
      registry: normaliseRegistry(result.registry),
      markRef: args.markRef ?? result.mark_ref ?? null,
      currencyDate: result.currencyDate || null,
      coverage: result.coverage === undefined ? undefined : asJson(result.coverage),
      resultCount: result.result_count,
      totalAvailable: result.total_available,
      totalAtLeast: result.total_at_least,
      upstreamCap: result.upstream_cap,
      truncated: result.truncated,
      status: result.status,
      failureReason: result.failure_reason,
      // Verbatim, including hits that will later be excluded.
      hits: asJson(result.results ?? []),
      rerunOfId: args.rerunOfId ?? null,
      runBy: args.runBy,
    },
    select: { id: true },
  });
  return row;
}

const hitsOf = (value: unknown): SmartSearchHit[] => (Array.isArray(value) ? (value as SmartSearchHit[]) : []);
const classesOf = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/**
 * The Clearances table. Company-scoped, newest first.
 *
 * `hits` is deliberately not selected: a list of fifty searches would drag
 * fifty snapshots of up to 250 hits across the wire to render a count. The
 * count comes from `resultCount`, which the facade already told us.
 */
export async function listSearches(companyId: string, limit = 50): Promise<HistoryRow[]> {
  const rows = await prisma.clearanceSearch.findMany({
    where: { companyId },
    orderBy: { runAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true, term: true, registry: true, classes: true, markRef: true,
      runAt: true, runBy: true, resultCount: true, status: true,
    },
  });

  // One lookup for the whole page rather than a join per row: runBy is a Clerk
  // id, and the readable name lives in the local users table.
  const clerkIds = Array.from(new Set(rows.map((r) => r.runBy).filter(Boolean) as string[]));
  const users = clerkIds.length
    ? await prisma.user.findMany({
        where: { clerkUserId: { in: clerkIds }, companyId },
        select: { clerkUserId: true, name: true, email: true },
      })
    : [];
  const nameByClerkId = new Map(users.map((u) => [u.clerkUserId, u.name || u.email]));

  return rows.map((r) => ({
    id: r.id,
    term: r.term,
    registry: r.registry,
    classes: classesOf(r.classes),
    markRef: r.markRef,
    runAt: r.runAt.toISOString(),
    runByName: r.runBy ? nameByClerkId.get(r.runBy) ?? null : null,
    hitCount: r.resultCount ?? 0,
    status: r.status,
    // Slice 2 attaches reports; until then every record honestly reports none.
    reportState: 'none' as const,
  }));
}

/** One record with its reviews, or null. Scoped: a foreign id reads as absent. */
export async function getRecord(companyId: string, id: string): Promise<
  { search: SavedSearch; reviews: Array<{ applicationNumber: string; tier: Tier; note: string | null; position: number | null }> } | null
> {
  const row = await prisma.clearanceSearch.findFirst({
    where: { id, companyId },
    include: { reviews: { select: { applicationNumber: true, tier: true, note: true, position: true } } },
  });
  if (!row) return null;

  return {
    search: {
      id: row.id,
      searchId: row.searchId,
      term: row.term,
      classes: classesOf(row.classes),
      registry: row.registry,
      markRef: row.markRef,
      currencyDate: row.currencyDate,
      coverage: row.coverage,
      resultCount: row.resultCount,
      totalAvailable: row.totalAvailable,
      totalAtLeast: row.totalAtLeast,
      upstreamCap: row.upstreamCap,
      truncated: row.truncated,
      status: row.status,
      failureReason: row.failureReason,
      hits: hitsOf(row.hits),
      rerunOfId: row.rerunOfId,
      runBy: row.runBy,
      runAt: row.runAt.toISOString(),
    },
    reviews: row.reviews.map((r) => ({
      applicationNumber: r.applicationNumber,
      tier: isTier(r.tier) ? r.tier : DEFAULT_TIER,
      note: r.note,
      position: r.position,
    })),
  };
}

export type ReviewUpdate = {
  applicationNumber: string;
  tier?: Tier;
  note?: string | null;
  position?: number | null;
};

/**
 * Apply judgement to hits, in bulk.
 *
 * Rejects any application number that is not in this record's snapshot. A
 * review row pointing at a hit the search never returned would be a judgement
 * with no evidence behind it, and would survive into a report as one.
 *
 * Upsert per row, in one transaction: applying a tier to forty rows either
 * lands whole or not at all, so a half-applied bulk action cannot leave a
 * reviewer thinking they finished.
 */
export async function applyHitReviews(
  companyId: string,
  id: string,
  updates: ReviewUpdate[],
  reviewedBy: string | null,
): Promise<{ applied: number; unknownApplicationNumbers: string[] }> {
  const record = await prisma.clearanceSearch.findFirst({
    where: { id, companyId },
    select: { id: true, hits: true },
  });
  if (!record) throw new RecordNotFound(id);

  const known = new Set(hitsOf(record.hits).map((h) => h.application_number));
  const unknown: string[] = [];
  const valid: ReviewUpdate[] = [];
  for (const u of updates) {
    if (!u?.applicationNumber) continue;
    if (!known.has(u.applicationNumber)) { unknown.push(u.applicationNumber); continue; }
    valid.push(u);
  }

  if (valid.length) {
    await prisma.$transaction(
      valid.map((u) =>
        prisma.clearanceHitReview.upsert({
          where: { searchId_applicationNumber: { searchId: id, applicationNumber: u.applicationNumber } },
          create: {
            searchId: id,
            applicationNumber: u.applicationNumber,
            tier: u.tier ?? DEFAULT_TIER,
            note: u.note ?? null,
            position: u.position ?? null,
            reviewedBy,
          },
          // Only what was sent is touched: setting a note must not silently
          // reset a tier someone else decided.
          update: {
            ...(u.tier !== undefined ? { tier: u.tier } : {}),
            ...(u.note !== undefined ? { note: u.note } : {}),
            ...(u.position !== undefined ? { position: u.position } : {}),
            reviewedBy,
            reviewedAt: new Date(),
          },
        }),
      ),
    );
  }
  return { applied: valid.length, unknownApplicationNumbers: unknown };
}

export class RecordNotFound extends Error {
  constructor(readonly id: string) {
    super(`No clearance search ${id} for this company`);
    this.name = 'RecordNotFound';
  }
}
