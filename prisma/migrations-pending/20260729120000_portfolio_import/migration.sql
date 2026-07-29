-- Portfolio import: idempotency hardening + import event log + rate-limit state.
-- STAGED, NOT APPLIED. Promote per prisma/migrations-pending/README.md
-- (apply DDL → patch schema.prisma → generate → move dir → migrate resolve).
-- Preview and Production share one Azure MySQL database — do not apply out of band.

-- 1. Idempotency as a database invariant.
--    lib/import-portfolio matches on (company, registry, application_number) in
--    application code and is correct without this index; the unique index makes
--    the "no duplicate mark per proprietor number" guarantee enforced by the DB
--    and enables a true Prisma upsert + blocks any concurrent double-insert.
--    application_number is nullable → MySQL permits multiple NULLs, so
--    hand-entered marks (no number) are unconstrained.
CREATE UNIQUE INDEX `trademarks_company_registry_appno_key`
  ON `trademarks` (`company_id`, `registry_name`, `application_number`);

-- 2. Import event log — one row per import. Durable home for the rollback
--    snapshot (replaces the local import-snapshots/ file for the admin path),
--    the import-history list, and the material a rollback reads.
CREATE TABLE `portfolio_imports` (
  `id`            VARCHAR(191) NOT NULL,
  `company_id`    VARCHAR(191) NOT NULL,
  `registry`      VARCHAR(16)  NOT NULL,                 -- facade path param, e.g. 'gb'
  `registry_name` VARCHAR(191) NOT NULL,                 -- DB registry_name, e.g. 'UKIPO'
  `owner_strings` JSON         NOT NULL,                 -- exact proprietor strings imported
  `currency_date` VARCHAR(16)  NULL,                     -- corpus 'as at' at import time
  `status`        VARCHAR(24)  NOT NULL,                 -- committed | failed | rolled_back
  `predicted`     JSON         NOT NULL,                 -- {marks, goodsServices, deadlines}
  `actual`        JSON         NULL,                     -- populated on commit
  `plan`          JSON         NOT NULL,                 -- {toInsert, toUpdate, stale[]}
  `pruned`        BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Rollback material. Small portfolios inline the snapshot as JSON; large ones
  -- (near the 2,000 cap) set snapshot_ref to an Azure blob key instead, to keep
  -- the row lean. Exactly one of the two is populated. (Decision, §5.)
  `snapshot`      JSON         NULL,                     -- facade doc + pre-image
  `snapshot_ref`  VARCHAR(512) NULL,                     -- blob key when offloaded
  `created_by`    VARCHAR(191) NULL,                     -- admin user id/email
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `portfolio_imports_company_id_idx` (`company_id`),
  KEY `portfolio_imports_created_at_idx` (`created_at`),
  CONSTRAINT `portfolio_imports_company_fk`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE
);

-- 3. Rate-limit state — bound how often an import runs per scope (company/user),
--    protecting the shared BaseX lane behind the facade's own per-request cap.
CREATE TABLE `import_rate_limits` (
  `scope`        VARCHAR(191) NOT NULL,                  -- e.g. 'company:asos-plc'
  `window_start` DATETIME(3)  NOT NULL,
  `count`        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`scope`)
);
