/**
 * Portfolio import service (server-side ONLY).
 * ============================================
 * Promotes the one-off scripts/load-gb-execute.ts into a service function
 * parameterised by company + owner strings. Sources marks from the registry
 * facade (not a file), transforms with the loader's own gates, and writes in a
 * single idempotent transaction.
 *
 * Every loader gate is preserved:
 *   1. abort-on-unmapped   — an unmapped registry status stops the import
 *                            before any write (prepareImport throws).
 *   2. predicted-vs-actual — post-write counts are asserted INSIDE the
 *                            transaction; a mismatch throws → full rollback.
 *   3. export snapshot      — prepareImport returns a snapshot (facade doc +
 *                            pre-image of affected marks) as rollback material;
 *                            the caller persists it BEFORE commitImport runs.
 *   4. one transaction      — all writes in a single prisma.$transaction.
 *   5. idempotent by app no  — marks are matched on (company, registry,
 *                            applicationNumber) and UPDATED in place, preserving
 *                            the mark id and its user children (notes, approvals,
 *                            inbound emails). New numbers are inserted. Nothing
 *                            duplicates on re-import. (No unique constraint
 *                            exists yet — that hardening is a proposed schema
 *                            addition; v1 matches in application code.)
 *
 * DECISION — absent marks: proprietor marks present before an import but ABSENT
 * from its result are, by default, LEFT UNTOUCHED and reported as `stale`
 * (deleting them would cascade user notes — Note.onDelete=Cascade). Pass
 * pruneAbsent:true only for a deliberate replace (e.g. first import over a
 * fabricated seed), which deletes them and their children.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './db';
import { getMarks, type MarksDoc } from './registry-facade';
import { readExportDoc, type ExportMark, type MappedMark } from './gb-transform';

export interface ImportOptions {
  companySlug: string;
  ownerStrings: string[];
  registry?: string; // facade path param (default 'gb')
  registryName?: string; // DB registry_name (default 'UKIPO')
  pruneAbsent?: boolean; // default false — see DECISION above
  marksDoc?: MarksDoc; // pre-fetched (tests); otherwise fetched from the facade
}

export interface Counts { marks: number; goodsServices: number; deadlines: number }

export interface ImportPlan {
  toInsert: number;
  toUpdate: number;
  stale: string[]; // application numbers present-before, absent-now
}

export interface PreImageMark {
  id: string;
  applicationNumber: string | null;
  status: string;
  registryStatusRaw: string | null;
  markText: string;
  goodsServices: number;
  deadlines: number;
}

export interface ImportSnapshot {
  importedAt: string;
  companySlug: string;
  companyId: string;
  registry: string;
  registryName: string;
  ownerStrings: string[];
  currencyDate: string;
  coverage: unknown;
  predicted: Counts;
  plan: ImportPlan;
  facadeExport: Record<string, unknown>; // the /marks `export` header
  marks: ExportMark[]; // raw facade marks — reproducible input
  preImage: PreImageMark[]; // affected existing marks — rollback material
}

export interface PreparedImport {
  companyId: string;
  companySlug: string;
  registry: string;
  registryName: string;
  currencyDate: string;
  pruneAbsent: boolean;
  mapped: MappedMark[];
  predicted: Counts;
  plan: ImportPlan;
  snapshot: ImportSnapshot;
}

export interface ImportResult {
  companyId: string;
  companySlug: string;
  registryName: string;
  written: true;
  predicted: Counts;
  actual: Counts;
  verified: true;
  plan: ImportPlan;
}

export class ImportAbortError extends Error {
  constructor(readonly reason: string) { super(`import aborted: ${reason}`); this.name = 'ImportAbortError'; }
}
export class ImportVerificationError extends Error {
  constructor(readonly predicted: Counts, readonly actual: Counts) {
    super(`import verification failed: predicted ${JSON.stringify(predicted)} ≠ actual ${JSON.stringify(actual)}`);
    this.name = 'ImportVerificationError';
  }
}

const predict = (mapped: MappedMark[]): Counts => ({
  marks: mapped.length,
  goodsServices: mapped.reduce((n, m) => n + m.goodsServices.length, 0),
  deadlines: mapped.reduce((n, m) => n + m.deadlines.length, 0),
});

// MappedMark → the Prisma trademark column set (shared by insert and update).
function markData(m: MappedMark) {
  return {
    familyId: null, // families are explicit entities, never inferred on import
    registryName: m.registryName,
    markText: m.markText,
    status: m.status,
    registryStatusRaw: m.registryStatusRaw,
    applicationNumber: m.applicationNumber,
    registrationNumber: m.registrationNumber,
    filingDate: m.filingDate,
    registrationDate: m.registrationDate,
    expiryDate: m.expiryDate,
    publicationDate: m.publicationDate,
    ownerName: m.ownerName,
    ownerCountry: m.ownerCountry,
    representativeName: m.representativeName,
    representativeReference: m.representativeReference,
    clientAgentName: m.clientAgentName,
    needsData: m.needsData,
  };
}

/**
 * Fetch + transform + plan, with the abort-on-unmapped gate, and build the
 * rollback snapshot. No database writes. The caller MUST persist
 * `prepared.snapshot` before calling commitImport.
 */
export async function prepareImport(opts: ImportOptions): Promise<PreparedImport> {
  const registry = opts.registry ?? 'gb';
  const registryName = opts.registryName ?? 'UKIPO';
  const pruneAbsent = opts.pruneAbsent ?? false;

  const company = await prisma.company.findUnique({ where: { slug: opts.companySlug }, select: { id: true } });
  if (!company) throw new ImportAbortError(`company '${opts.companySlug}' not found`);

  const doc = opts.marksDoc ?? (await getMarks(opts.ownerStrings, registry));

  // Scope to the requested proprietors (owner match, never representative-only),
  // and run the loader's transform + unmapped-status gate.
  const scope = new Set(opts.ownerStrings);
  const { mapped, unmappedStatuses } = readExportDoc(
    { export: doc.export, marks: doc.marks as ExportMark[] },
    scope,
  );
  if (unmappedStatuses.length) throw new ImportAbortError(`unmapped registry status values: ${unmappedStatuses.join(', ')}`);
  if (!mapped.length) throw new ImportAbortError('no in-scope marks for the given owner strings');

  const predicted = predict(mapped);

  // Existing state → plan (insert vs update vs stale) + pre-image for rollback.
  const existing = await prisma.trademark.findMany({
    where: { companyId: company.id, registryName },
    select: { id: true, applicationNumber: true, status: true, registryStatusRaw: true, markText: true,
      _count: { select: { goodsServices: true, deadlines: true } } },
  });
  const byApp = new Map(existing.filter((e) => e.applicationNumber).map((e) => [e.applicationNumber as string, e]));
  const incoming = new Set(mapped.map((m) => m.applicationNumber));
  const toUpdate = mapped.filter((m) => byApp.has(m.applicationNumber)).length;
  const toInsert = mapped.length - toUpdate;
  const stale = existing.filter((e) => e.applicationNumber && !incoming.has(e.applicationNumber)).map((e) => e.applicationNumber as string);

  // Pre-image = existing marks that this import will change or prune.
  const affected = existing.filter((e) => (e.applicationNumber && incoming.has(e.applicationNumber)) || (pruneAbsent && e.applicationNumber && !incoming.has(e.applicationNumber)));
  const preImage: PreImageMark[] = affected.map((e) => ({
    id: e.id,
    applicationNumber: e.applicationNumber,
    status: e.status,
    registryStatusRaw: e.registryStatusRaw,
    markText: e.markText,
    goodsServices: e._count.goodsServices,
    deadlines: e._count.deadlines,
  }));

  const plan: ImportPlan = { toInsert, toUpdate, stale };
  const snapshot: ImportSnapshot = {
    importedAt: new Date().toISOString(),
    companySlug: opts.companySlug,
    companyId: company.id,
    registry,
    registryName,
    ownerStrings: opts.ownerStrings,
    currencyDate: doc.currencyDate,
    coverage: doc.coverage,
    predicted,
    plan,
    facadeExport: doc.export,
    marks: doc.marks as ExportMark[],
    preImage,
  };

  return { companyId: company.id, companySlug: opts.companySlug, registry, registryName, currencyDate: doc.currencyDate, pruneAbsent, mapped, predicted, plan, snapshot };
}

/**
 * Execute the prepared import in one transaction. Idempotent by application
 * number; verifies predicted == actual inside the transaction and rolls back
 * (throws) on any mismatch.
 */
export async function commitImport(prepared: PreparedImport): Promise<ImportResult> {
  const { companyId, registryName, mapped, predicted, pruneAbsent } = prepared;

  const actual = await prisma.$transaction(
    async (tx) => {
      // Re-read existing inside the transaction for a consistent match.
      const existing = await tx.trademark.findMany({ where: { companyId, registryName }, select: { id: true, applicationNumber: true } });
      const byApp = new Map(existing.filter((e) => e.applicationNumber).map((e) => [e.applicationNumber as string, e.id]));
      const incoming = new Set(mapped.map((m) => m.applicationNumber));

      const updates = mapped.filter((m) => byApp.has(m.applicationNumber));
      const inserts = mapped.filter((m) => !byApp.has(m.applicationNumber));
      const matchedIds = updates.map((m) => byApp.get(m.applicationNumber) as string);
      const insertRows = inserts.map((m) => ({ id: randomUUID(), m }));
      const importedIds = [...matchedIds, ...insertRows.map((r) => r.id)];

      // Update existing marks in place (preserves id + user children).
      for (const m of updates) {
        await tx.trademark.update({ where: { id: byApp.get(m.applicationNumber) as string }, data: markData(m) });
      }
      // Insert new marks in bulk.
      if (insertRows.length) {
        await tx.trademark.createMany({ data: insertRows.map(({ id, m }) => ({ id, companyId, ...markData(m) })) });
      }
      // Replace derived children for the whole imported set (idempotent).
      if (matchedIds.length) {
        await tx.goodsService.deleteMany({ where: { trademarkId: { in: matchedIds } } });
        await tx.deadline.deleteMany({ where: { trademarkId: { in: matchedIds } } });
      }
      const idOf = new Map<string, string>([
        ...updates.map((m) => [m.applicationNumber, byApp.get(m.applicationNumber) as string] as const),
        ...insertRows.map((r) => [r.m.applicationNumber, r.id] as const),
      ]);
      await tx.goodsService.createMany({
        data: mapped.flatMap((m) => m.goodsServices.map((g) => ({ trademarkId: idOf.get(m.applicationNumber) as string, classNumber: g.classNumber, text: g.description }))),
      });
      await tx.deadline.createMany({
        data: mapped.flatMap((m) => m.deadlines.map((d) => ({ trademarkId: idOf.get(m.applicationNumber) as string, type: d.type, description: d.description, dueDate: d.dueDate, windowStart: d.windowStart }))),
      });

      // Prune absent marks only when explicitly requested.
      if (pruneAbsent) {
        const staleIds = existing.filter((e) => e.applicationNumber && !incoming.has(e.applicationNumber)).map((e) => e.id);
        if (staleIds.length) await tx.trademark.deleteMany({ where: { id: { in: staleIds } } });
      }

      // Verify predicted == actual for the imported set — throw → rollback.
      const a: Counts = {
        marks: await tx.trademark.count({ where: { id: { in: importedIds } } }),
        goodsServices: await tx.goodsService.count({ where: { trademarkId: { in: importedIds } } }),
        deadlines: await tx.deadline.count({ where: { trademarkId: { in: importedIds } } }),
      };
      if (a.marks !== predicted.marks || a.goodsServices !== predicted.goodsServices || a.deadlines !== predicted.deadlines) {
        throw new ImportVerificationError(predicted, a);
      }
      return a;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  return { companyId, companySlug: prepared.companySlug, registryName, written: true, predicted, actual, verified: true, plan: prepared.plan };
}

/** Convenience: prepare → (persist snapshot via sink) → commit. */
export async function importPortfolio(
  opts: ImportOptions,
  persistSnapshot?: (s: ImportSnapshot) => Promise<void> | void,
): Promise<ImportResult> {
  const prepared = await prepareImport(opts);
  if (persistSnapshot) await persistSnapshot(prepared.snapshot);
  return commitImport(prepared);
}
