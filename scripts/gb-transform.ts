/**
 * Shared transform: live-GB registry export → BrandVault schema shape.
 *
 * Side-effect free. Imported by scripts/load-gb-export.ts (report) and
 * scripts/load-gb-execute.ts (load) so the mapping has one definition and the
 * dry run cannot drift from what actually gets written.
 *
 * Source is verbatim GB registry XML flattened to JSON: dates arrive as a
 * path/value list, applicants and representatives as field/value pair groups,
 * mark_text as a list (a mark may have no verbal element at all).
 *
 * Decisions here are the ones approved in docs/gb-load-plan.md.
 */
import { readFileSync } from 'node:fs';
import { MarkStatus } from '@prisma/client';
import { getObligationsForTrademark } from '../lib/utils';
import type { Trademark } from '../types/trademark';

/**
 * Load scope: applicant-owned marks only. The export matched on owner AND
 * representative, so it also carries marks where ASOS is merely the
 * representative, plus a same-name third party. Real register facts, but not
 * ASOS's portfolio.
 */
export const APPLICANTS_IN_SCOPE = new Set(['ASOS plc', 'ASOS HOLDINGS LIMITED']);

/**
 * Approved status mapping. Source vocabulary is exactly these four values,
 * verified against TradeMark/IPOPublicMarkCurrentStatusCode (agrees on all 173).
 *
 * Total (an unrecognised value aborts), conservative (live-but-unregistered
 * states map to live enum values so nothing carrying an obligation is hidden),
 * and lossless — the verbatim string is written to registryStatusRaw on every
 * row regardless of what it maps to.
 */
export const STATUS_MAP: Record<string, MarkStatus> = {
  Registered: MarkStatus.Registered,
  Withdrawn: MarkStatus.Abandoned,
  'Application Published': MarkStatus.Published,
  Examination: MarkStatus.Pending,
};

/**
 * Statuses for which the loader suppresses deadline generation.
 *
 * The obligation engine derives UKIPO renewals from the FILING date and gates
 * on nothing else, so a withdrawn application would otherwise be given renewal
 * deadlines — live-looking obligations on a dead mark. Gated here rather than
 * in the engine, which CLAUDE.md marks as preserved code. Logged as a post-demo
 * product issue: this bites for any imported dead mark, not just these six.
 */
export const NO_DEADLINE_STATUSES = new Set<MarkStatus>([MarkStatus.Abandoned, MarkStatus.Expired]);

/**
 * UKIPO single-number convention, applied as an explicit documented load rule.
 *
 * The source export carries no registration-number element at all: 680 distinct
 * leaf elements across the file, none of them a registration number. So there is
 * nothing to backfill FROM, and the number has to come from the convention or
 * stay null.
 *
 * UKIPO issues one number per right. For a UK000 national mark and for a UK009
 * comparable mark (created as a registered right on EU exit, with a UK number
 * UKIPO itself assigned) that number IS the registration identifier once the
 * mark is registered, so writing it describes a fact rather than inventing one.
 *
 * UK008 is deliberately excluded: that number identifies the international
 * registration designating the UK, not a UK registration number. It stays null
 * pending a separate decision.
 *
 * THIS IS UKIPO ONLY AND MUST NOT BE GENERALISED. EUIPO, USPTO and WIPO issue
 * registration numbers distinct from the application number; copying one across
 * in those registries would fabricate an identifier.
 */
export const REG_NUMBER_PREFIXES = ['UK000', 'UK009'] as const;

export function ukRegistrationNumber(applicationNumber: string, status: MarkStatus): string | null {
  if (status !== MarkStatus.Registered) return null;
  if (!REG_NUMBER_PREFIXES.some((p) => applicationNumber.startsWith(p))) return null;
  return applicationNumber;
}

/**
 * Display text for a figurative mark with no verbal element.
 *
 * The application number is part of the stored string rather than added by the
 * UI: the whole value is synthetic already (the mark genuinely has no text),
 * and the deadline rows in ActionsTab/RightPanel show mark text with no number
 * alongside and truncate with an ellipsis. Baking it in keeps the 7 device
 * marks identifiable in every view without touching display code before a demo.
 */
export const deviceMarkLabel = (applicationNumber: string) =>
  `[device mark, no verbal element] ${applicationNumber}`;

/* ── source types ─────────────────────────────────────────────── */
export interface FieldPair { field: string; value: string }
export interface ExportMark {
  application_number: string;
  mark_text: string[];
  status: string;
  series_prefix: string;
  mark_feature: string;
  kind_mark: string;
  doc_name: string;
  // Present in the export FILE; omitted by the facade (node ids renumber on
  // db:optimize — never a key). transform() never reads it.
  node_id?: string;
  matched_via: string[];
  matched_owner_strings: string[];
  dates: Array<{ path: string; value: string }>;
  goods_services: Array<{ class_number: string; description: string; language_code?: string }>;
  applicants: FieldPair[][];
  representatives: FieldPair[][];
  all_leaf_elements: Array<{ path: string; value: string }>;
}

export interface MappedMark {
  markText: string;
  markTextSynthesised: boolean;
  registryName: string;
  status: MarkStatus;
  registryStatusRaw: string;
  applicationNumber: string;
  registrationNumber: string | null;
  filingDate: Date | null;
  registrationDate: Date | null;
  expiryDate: Date | null;
  publicationDate: Date | null;
  ownerName: string | null;
  ownerCountry: string | null;
  representativeName: string | null;
  representativeReference: string | null;
  clientAgentName: string | null;
  needsData: boolean;
  seriesPrefix: string;
  goodsServices: Array<{ classNumber: number; description: string }>;
  deadlines: Array<{ type: string; description: string; dueDate: Date; windowStart: Date }>;
  deadlinesSuppressed: boolean;
}

/* ── helpers ──────────────────────────────────────────────────── */
const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length ? s : null;
};

/**
 * Take the registry's CALENDAR date, not an instant.
 *
 * GB dates arrive as '2034-07-15Z', '1979-11-13T00:00:00.000Z' and
 * '1969-07-15T00:00:00.000+01:00'. Parsing the last with `new Date()` yields
 * 1969-07-14T23:00Z — the date moves back a day, because BST is +01:00. 96 of
 * the 173 in-scope marks carry at least one such date. A trademark date is a
 * calendar date on the register and a legal fact, so take the leading
 * YYYY-MM-DD and pin it to UTC midnight.
 */
export const regDate = (v: unknown): Date | null => {
  const s = clean(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const dateAt = (mk: ExportMark, suffix: string): Date | null =>
  regDate(mk.dates.find((d) => d.path.endsWith(suffix))?.value);

const pair = (groups: FieldPair[][], suffix: string): string | null => {
  for (const g of groups) for (const f of g) if (f.field.endsWith(suffix)) return clean(f.value);
  return null;
};

export const applicantNames = (mk: ExportMark): string[] =>
  mk.applicants.flatMap((g) => g.filter((f) => f.field.endsWith('Applicant/Name')).map((f) => f.value));

export const inScope = (mk: ExportMark): boolean =>
  applicantNames(mk).some((n) => APPLICANTS_IN_SCOPE.has(n));

/* ── transform ────────────────────────────────────────────────── */
export function transform(mk: ExportMark): MappedMark {
  const filingDate = dateAt(mk, 'TradeMark/ApplicationDateTime');
  const registrationDate = dateAt(mk, 'TradeMark/RegistrationDate');
  const verbal = mk.mark_text.map(clean).filter((s): s is string => !!s);
  const status = STATUS_MAP[mk.status];

  const obligations = getObligationsForTrademark({
    registry_name: 'UKIPO',
    filing_date: filingDate ? filingDate.toISOString() : undefined,
    registration_date: registrationDate ? registrationDate.toISOString() : undefined,
  } as Trademark);

  const suppress = NO_DEADLINE_STATUSES.has(status);
  const concrete = suppress ? [] : obligations.filter((o) => !o.uncertain && o.dueDate);

  return {
    // A device mark has no verbal element by nature, not by omission — this
    // does not set needsData.
    markText: verbal[0] ?? deviceMarkLabel(mk.application_number),
    markTextSynthesised: verbal.length === 0,
    registryName: 'UKIPO',
    status,
    registryStatusRaw: mk.status,
    applicationNumber: mk.application_number,
    registrationNumber: ukRegistrationNumber(mk.application_number, status),
    filingDate,
    registrationDate,
    expiryDate: dateAt(mk, 'TradeMark/ExpiryDate'),
    publicationDate: dateAt(mk, 'PublicationDetails/Publication/PublicationDate'),
    ownerName: pair(mk.applicants, 'Applicant/Name'),
    ownerCountry: pair(mk.applicants, 'Applicant/AddressBook/CountryCode'),
    representativeName: pair(mk.representatives, 'Representative/Name'),
    // GB register data has no Representative/Reference field.
    representativeReference: null,
    // No register equivalent; the fabricated rows' "ASOS PLC Legal Department"
    // is not reproduced.
    clientAgentName: null,
    needsData: obligations.some((o) => o.uncertain),
    seriesPrefix: mk.series_prefix,
    goodsServices: mk.goods_services.map((g) => ({
      classNumber: Number.parseInt(g.class_number, 10),
      description: g.description,
    })),
    deadlines: concrete.map((o) => ({
      type: o.type,
      description: o.desc,
      dueDate: o.dueDate as Date,
      windowStart: (o.windowStart ?? o.dueDate) as Date,
    })),
    deadlinesSuppressed: suppress,
  };
}

/**
 * Split + transform an in-memory export doc ({ export, marks }). This is the
 * shared core: the same shape comes from the export FILE and from the registry
 * facade's /marks response, so the loader pipeline is source-agnostic.
 */
export function readExportDoc(doc: { export?: Record<string, unknown>; marks?: ExportMark[] }) {
  const all: ExportMark[] = doc.marks ?? [];
  const scoped = all.filter(inScope);
  return {
    header: doc.export ?? {},
    all,
    inScope: scoped,
    excluded: all.filter((m) => !inScope(m)),
    mapped: scoped.map(transform),
    unmappedStatuses: Array.from(new Set(scoped.map((m) => m.status))).filter((s) => !(s in STATUS_MAP)),
  };
}

/** Read an export file and return its header plus in-scope/excluded split. */
export function readExport(path: string) {
  const doc = JSON.parse(readFileSync(path.replace(/^~/, process.env.HOME ?? '~'), 'utf8'));
  return readExportDoc(doc);
}
