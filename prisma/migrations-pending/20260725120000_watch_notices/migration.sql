-- STAGED FOR REVIEW — NOT APPLIED. See prisma/migrations-pending/README.md.
--
-- Third-party filing notices (UKIPO notification of earlier rights, and the
-- equivalent from a commercial watch service). One row per CITED customer mark:
-- a letter citing two of the customer's rights produces two rows, so each row
-- anchors to exactly one trademark_id and the comparison view has one subject.
--
-- Additive only. No existing table or column is altered, so this cannot change
-- the behaviour of anything already deployed against the shared Azure database.
--
-- trademark_id is NOT NULL by design: a notice that matches nothing in the
-- portfolio is never written here. It stays on inbound_emails with a "no
-- matching right" note and is surfaced in /inbox only (spec 1a). Making the
-- anchor mandatory is what stops a guessed-by-mark-text match from ever
-- reaching the comparison view.
--
-- third_party_classes is JSON holding an array of integers, e.g. [18, 25].
-- Stored as filed. Class intersection is computed at render time against the
-- customer mark's goods_services rows; nothing derived is persisted here.
--
-- opposition_deadline is nullable: the two-month period is stated on UKIPO
-- notices but not on every watch-service alert. Absent means "not stated in
-- the notice", never "no deadline exists" — the view omits the countdown
-- rather than inventing one.

-- Matching prisma/schema.prisma patch, to be applied at promotion step 2 (NOT
-- applied yet — the schema and the database must move together):
--
--   model WatchNotice {
--     id                          String   @id @default(cuid())
--     companyId                   String   @map("company_id")
--     trademarkId                 String   @map("trademark_id")
--     thirdPartyMarkText          String   @map("third_party_mark_text")
--     thirdPartyApplicationNumber String   @map("third_party_application_number")
--     thirdPartyClasses           Json     @map("third_party_classes")
--     filingDate                  DateTime? @map("filing_date")
--     oppositionDeadline          DateTime? @map("opposition_deadline")
--     sourceEmailId               String?  @map("source_email_id")
--     createdAt                   DateTime @default(now()) @map("created_at")
--
--     company     Company       @relation(fields: [companyId], references: [id], onDelete: Cascade)
--     trademark   Trademark     @relation(fields: [trademarkId], references: [id], onDelete: Cascade)
--     sourceEmail InboundEmail? @relation(fields: [sourceEmailId], references: [id], onDelete: SetNull)
--
--     @@unique([trademarkId, thirdPartyApplicationNumber])
--     @@index([companyId, createdAt])
--     @@index([trademarkId])
--     @@map("watch_notices")
--   }
--
-- Plus back-relations: `watchNotices WatchNotice[]` on Company, Trademark and
-- InboundEmail.

CREATE TABLE `watch_notices` (
    `id` VARCHAR(191) NOT NULL,
    `company_id` VARCHAR(191) NOT NULL,
    `trademark_id` VARCHAR(191) NOT NULL,
    `third_party_mark_text` VARCHAR(191) NOT NULL,
    `third_party_application_number` VARCHAR(191) NOT NULL,
    `third_party_classes` JSON NOT NULL,
    `filing_date` DATETIME(3) NULL,
    `opposition_deadline` DATETIME(3) NULL,
    `source_email_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `watch_notices_company_id_created_at_idx`(`company_id`, `created_at`),
    INDEX `watch_notices_trademark_id_idx`(`trademark_id`),

    -- One notice per (cited mark, third-party application). Re-processing the
    -- same letter, or a duplicate forward of it, updates rather than duplicates.
    UNIQUE INDEX `watch_notices_trademark_id_third_party_application_number_key`(`trademark_id`, `third_party_application_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `watch_notices` ADD CONSTRAINT `watch_notices_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `watch_notices` ADD CONSTRAINT `watch_notices_trademark_id_fkey` FOREIGN KEY (`trademark_id`) REFERENCES `trademarks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SET NULL, matching `approvals`. Deleting a processed email
-- must not delete the notice it produced.
ALTER TABLE `watch_notices` ADD CONSTRAINT `watch_notices_source_email_id_fkey` FOREIGN KEY (`source_email_id`) REFERENCES `inbound_emails`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
