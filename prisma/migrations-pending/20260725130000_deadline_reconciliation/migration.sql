-- STAGED FOR REVIEW — NOT APPLIED. See prisma/migrations-pending/README.md.
--
-- Persist the two dates behind a renewal deadline, plus the discrepancy flag.
--
-- The reconciliation behaviour does NOT depend on this migration. recalcDeadlines
-- already reconciles: it drops drifted past renewals on live marks and adds a row
-- on the registry expiry date, so the earliest future row is the governing one.
-- The display already reconciles too, recomputing the calculated date at read
-- time (lib/reconciliation.ts, reconciliationForMark).
--
-- What this migration adds is provenance: which date came from the registry,
-- which the engine derived, and whether they disagreed at the time the row was
-- written. That turns "why is this mark alerting on this date" from a
-- recomputation into a lookup, and it is what a future spec-vs-spec or
-- audit view would read.
--
-- Additive and nullable throughout. Existing rows keep NULL in the two date
-- columns and false in the flag until the next recalc rewrites them, and every
-- consumer today reads due_date, which is unchanged.

ALTER TABLE `deadlines`
  ADD COLUMN `registry_expiry_date` DATETIME(3) NULL,
  ADD COLUMN `calculated_due_date` DATETIME(3) NULL,
  ADD COLUMN `dates_differ` BOOLEAN NOT NULL DEFAULT false;

-- Matching prisma/schema.prisma patch, applied at promotion step 2 (NOT applied
-- yet — the schema and the database must move together):
--
--   model Deadline {
--     ...
--     registryExpiryDate DateTime? @map("registry_expiry_date")
--     calculatedDueDate  DateTime? @map("calculated_due_date")
--     datesDiffer        Boolean   @default(false) @map("dates_differ")
--     ...
--   }
--
-- At promotion, recalcDeadlines writes these three alongside due_date, and
-- scripts/backfill-deadlines.ts populates them for every existing mark.
