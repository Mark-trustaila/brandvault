/**
 * Portfolio-import event log + rate limiting (server-side).
 * =========================================================
 * Persists each import to `portfolio_imports` (durable snapshot / history /
 * rollback material) and enforces the per-scope rate limit via
 * `import_rate_limits`. Both tables landed in migration
 * 20260729120000_portfolio_import.
 *
 * Rate defaults (docs/self-serve-import-spec-v1.md §4): 10 searches/hour and
 * 3 imports/day per org.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import type { PreparedImport, Counts } from './import-portfolio';

export const SEARCH_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 }; // 10 / hour
export const IMPORT_LIMIT = { max: 3, windowMs: 24 * 60 * 60 * 1000 }; // 3 / day
const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB inline threshold; blob deferred

const asJson = (v: unknown) => v as unknown as Prisma.InputJsonValue;

/**
 * Sliding fixed-window limiter keyed by `scope`. Returns whether the call is
 * allowed and when the window resets. Increments on allow.
 */
export async function rateLimit(
  scope: string,
  max: number,
  windowMs: number,
  now: Date,
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const existing = await prisma.importRateLimit.findUnique({ where: { scope } });
  if (!existing || now.getTime() - existing.windowStart.getTime() >= windowMs) {
    await prisma.importRateLimit.upsert({
      where: { scope },
      create: { scope, windowStart: now, count: 1 },
      update: { windowStart: now, count: 1 },
    });
    return { allowed: true, remaining: max - 1, resetAt: new Date(now.getTime() + windowMs) };
  }
  const resetAt = new Date(existing.windowStart.getTime() + windowMs);
  if (existing.count >= max) return { allowed: false, remaining: 0, resetAt };
  await prisma.importRateLimit.update({ where: { scope }, data: { count: { increment: 1 } } });
  return { allowed: true, remaining: max - 1 - existing.count, resetAt };
}

/**
 * Insert the import event with its snapshot BEFORE the write — rollback
 * material must be durable before commit. Snapshot inlined under 5 MB; above
 * it the inline snapshot is omitted (blob offload deferred). Returns the id.
 */
export async function startImportEvent(prepared: PreparedImport, createdBy: string | null): Promise<string> {
  const serialized = JSON.stringify(prepared.snapshot);
  const inline = Buffer.byteLength(serialized, 'utf8') <= SNAPSHOT_MAX_BYTES ? prepared.snapshot : null;
  const row = await prisma.portfolioImport.create({
    data: {
      companyId: prepared.companyId,
      registry: prepared.registry,
      registryName: prepared.registryName,
      ownerStrings: asJson(prepared.snapshot.ownerStrings),
      currencyDate: prepared.currencyDate,
      status: 'committing',
      predicted: asJson(prepared.predicted),
      plan: asJson(prepared.plan),
      pruned: prepared.pruneAbsent,
      snapshot: inline ? asJson(inline) : Prisma.JsonNull,
      snapshotRef: null,
      createdBy,
    },
    select: { id: true },
  });
  return row.id;
}

/** Record the outcome of the import event. */
export async function finishImportEvent(
  id: string,
  status: 'committed' | 'failed' | 'rolled_back',
  actual?: Counts,
): Promise<void> {
  await prisma.portfolioImport.update({
    where: { id },
    data: { status, actual: actual ? asJson(actual) : Prisma.JsonNull },
  });
}
