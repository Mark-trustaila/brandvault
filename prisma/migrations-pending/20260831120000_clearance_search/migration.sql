-- Clearance search: the saved record and its review (docs/clearance-workflow.md §3).
-- STAGED, NOT APPLIED. Promote per prisma/migrations-pending/README.md
-- (apply DDL → move dir → migrate resolve). Preview and Production share one
-- Azure MySQL database — do not apply out of band.
--
-- Both tables are NEW. Nothing existing gains a column, so an unapplied
-- migration cannot break a query that works today: only /api/clearance* fails,
-- and it fails loudly with "Table doesn't exist" rather than silently.

-- 1. One row per search, written the moment it settles.
--    `hits` holds the normalised results verbatim, including hits later
--    excluded. The register moves; what was seen and dismissed on the day is
--    part of the record, and a report generated later must be able to cite it.
CREATE TABLE `clearance_searches` (
  `id`              VARCHAR(191)  NOT NULL,
  `company_id`      VARCHAR(191)  NOT NULL,
  `search_id`       VARCHAR(1024) NOT NULL,               -- facade id; a signed token, never parsed
  `term`            VARCHAR(191)  NOT NULL,
  `classes`         JSON          NOT NULL,               -- string[] of Nice classes as submitted
  `registry`        VARCHAR(16)   NOT NULL,               -- facade path param: 'gb' | 'wo'
  `mark_ref`        VARCHAR(64)   NULL,                   -- portfolio mark it was run from
  -- Honesty fields, verbatim from the facade (contract §3.3). Stored, not
  -- re-fetched: a report must cite the date the search actually saw.
  `currency_date`   VARCHAR(16)   NULL,
  `coverage`        JSON          NULL,
  -- Cap discipline. total_available is NULL when upstream capped without
  -- saying how many it had; total_at_least then carries the floor.
  `result_count`    INT           NULL,
  `total_available` INT           NULL,
  `total_at_least`  INT           NULL,
  `upstream_cap`    INT           NULL,
  `truncated`       BOOLEAN       NOT NULL DEFAULT FALSE,
  `status`          VARCHAR(16)   NOT NULL,               -- completed | failed
  `failure_reason`  TEXT          NULL,
  `hits`            JSON          NOT NULL,
  `rerun_of_id`     VARCHAR(191)  NULL,                   -- the record this re-runs
  `run_by`          VARCHAR(191)  NULL,                   -- Clerk user id
  `run_at`          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `clearance_searches_company_run_at_idx` (`company_id`, `run_at`),
  INDEX `clearance_searches_mark_ref_idx` (`mark_ref`),
  CONSTRAINT `clearance_searches_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- SET NULL, not CASCADE: deleting a superseded search must not delete the
  -- one that replaced it.
  CONSTRAINT `clearance_searches_rerun_of_id_fkey`
    FOREIGN KEY (`rerun_of_id`) REFERENCES `clearance_searches` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. The lawyer's judgement on one hit. Separate table so applying a tier or
--    writing a note can never mutate the snapshot it refers to.
CREATE TABLE `clearance_hit_reviews` (
  `id`                 VARCHAR(191) NOT NULL,
  `search_id`          VARCHAR(191) NOT NULL,
  `application_number` VARCHAR(64)  NOT NULL,
  `tier`               VARCHAR(16)  NOT NULL DEFAULT 'appendix',  -- highlight | appendix | exclude
  `note`               TEXT         NULL,
  `position`           INT          NULL,                          -- order within highlight only
  `reviewed_by`        VARCHAR(191) NULL,
  `reviewed_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  -- One judgement per hit per search: reviewing twice updates, never accumulates.
  UNIQUE INDEX `clearance_hit_reviews_search_appno_key` (`search_id`, `application_number`),
  INDEX `clearance_hit_reviews_search_tier_idx` (`search_id`, `tier`),
  CONSTRAINT `clearance_hit_reviews_search_id_fkey`
    FOREIGN KEY (`search_id`) REFERENCES `clearance_searches` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
