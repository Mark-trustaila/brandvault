import type { AuditLog, GoodsService, Note, Trademark, User } from '@prisma/client';
import { getInitials } from './utils';

const iso = (d: Date | null): string | undefined => d?.toISOString();

/**
 * Map a DB trademark (+ its goods) to the shape the dashboard expects
 * (see types/trademark.ts). Keeps the API contract identical to the old
 * static-JSON payload.
 */
export function serializeTrademark(m: Trademark & { goodsServices: GoodsService[] }) {
  return {
    id: m.id,
    family_id: m.familyId ?? null,
    registry_name: m.registryName,
    mark_text: m.markText,
    application_number: m.applicationNumber ?? '',
    registration_number: m.registrationNumber ?? undefined,
    status: m.status,
    filing_date: iso(m.filingDate),
    registration_date: iso(m.registrationDate),
    expiry_date: iso(m.expiryDate),
    publication_date: iso(m.publicationDate),
    client_agent_name: m.clientAgentName ?? undefined,
    owner_name: m.ownerName ?? undefined,
    owner_country: m.ownerCountry ?? undefined,
    representative_name: m.representativeName ?? undefined,
    representative_reference: m.representativeReference ?? undefined,
    needs_data: m.needsData ?? false,
    // Verbatim registry status, written by the registry loader. Its presence is
    // what marks a record as registry-synced rather than hand-entered.
    registry_status_raw: m.registryStatusRaw ?? undefined,
    good_and_services: m.goodsServices.map((g) => ({
      search_class: { number: g.classNumber },
      text: g.text,
    })),
    publication_notes: '',
  };
}

/**
 * Map a DB note (+ its author) to the frontend Note shape. `text` carries the
 * sanitised HTML the composer produces (legacy from the localStorage version,
 * rendered via dangerouslySetInnerHTML).
 */
export function serializeNote(n: Note & { user: User | null }) {
  return {
    id: n.id,
    text: n.text,
    html: n.html ?? undefined,
    link: n.link ?? undefined,
    author: getInitials(n.user?.name ?? ''),
    authorFull: n.user?.name ?? 'Unknown',
    date: n.createdAt.toISOString(),
  };
}

/**
 * Map a DB audit entry (+ actor) for the customer's activity feed. Platform-
 * admin actions surface as "BrandVault Support" rather than the operator's name.
 */
export function serializeAudit(a: AuditLog & { user: User | null }) {
  return {
    id: a.id,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    reason: a.reason ?? undefined,
    isPlatformAdmin: a.isPlatformAdmin,
    // A non-human actor (e.g. Bree) wins; else support for admin edits, else the user.
    actor: a.actor ?? (a.isPlatformAdmin ? 'BrandVault Support' : a.user?.name ?? 'Unknown'),
    detail: a.detailJson ?? undefined,
    date: a.createdAt.toISOString(),
  };
}
