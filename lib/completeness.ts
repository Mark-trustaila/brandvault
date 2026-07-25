import type { Trademark } from '../types/trademark';

/**
 * Per-mark completeness: which optional fields are filled. Required fields
 * (mark, registry, status) are always present, so they're not scored. Used for
 * gentle "fill the gaps" prompts, never a blocking error.
 *
 * Scoring is scoped by provenance: a field the record's source cannot supply is
 * not counted against it.
 */

/**
 * A record loaded from a registry, rather than entered by hand. The registry
 * loader writes the verbatim status to registry_status_raw on every row, so its
 * presence is the provenance signal. No schema change was needed for this.
 */
export const isRegistrySynced = (t: Trademark): boolean => Boolean(t.registry_status_raw);

/**
 * `appliesTo` excludes a field from scoring where the source genuinely cannot
 * supply it. Prompting for data that does not exist trains people to ignore the
 * prompt, and it makes a complete record look incomplete forever.
 */
const FIELDS: { label: string; filled: (t: Trademark) => boolean; appliesTo?: (t: Trademark) => boolean }[] = [
  { label: 'Application no.', filled: (t) => !!t.application_number },
  { label: 'Registration no.', filled: (t) => !!t.registration_number },
  { label: 'Filing date', filled: (t) => !!t.filing_date },
  { label: 'Registration date', filled: (t) => !!t.registration_date },
  { label: 'Expiry date', filled: (t) => !!t.expiry_date },
  {
    label: 'Client / agent',
    filled: (t) => !!t.client_agent_name,
    // No register carries a client/agent. It is null by design on every
    // imported mark, so it is only scored on hand-entered records.
    appliesTo: (t) => !isRegistrySynced(t),
  },
  { label: 'Goods & services', filled: (t) => (t.good_and_services?.length ?? 0) > 0 },
  { label: 'Family', filled: (t) => !!t.family_id },
];

export function computeCompleteness(t: Trademark): {
  filled: number;
  total: number;
  pct: number;
  missing: string[];
} {
  const applicable = FIELDS.filter((f) => f.appliesTo?.(t) ?? true);
  const missing = applicable.filter((f) => !f.filled(t)).map((f) => f.label);
  const filled = applicable.length - missing.length;
  const total = applicable.length;
  return { filled, total, pct: Math.round((filled / total) * 100), missing };
}
