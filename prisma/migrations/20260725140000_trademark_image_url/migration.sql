-- STAGED FOR REVIEW — NOT APPLIED. See prisma/migrations-pending/README.md.
--
-- Device-mark images. A figurative mark has no verbal element, so the tile and
-- the detail header currently show a plain coloured square. For the seven GB
-- device marks we have verified image URLs and can show the mark itself.
--
-- Nullable by design and null nearly everywhere: only records with a verified
-- image get a value. Everything else keeps the plain delettered tile, so this
-- column being empty is the normal case, not a gap to prompt about. It is
-- deliberately NOT added to the completeness scoring.
--
-- The URL is stored rather than an asset: images are served from the LawPanel
-- CDN, a one-directional dependency (BrandVault reads, never writes). If that
-- CDN is unavailable the tile falls back to the plain treatment.
--
-- Additive. No existing column or row is altered.

ALTER TABLE `trademarks`
  ADD COLUMN `image_url` VARCHAR(1024) NULL;

-- Matching prisma/schema.prisma patch, applied at promotion step 2 (NOT applied
-- yet — the schema and the database must move together):
--
--   model Trademark {
--     ...
--     imageUrl String? @map("image_url") @db.VarChar(1024)
--     ...
--   }
--
-- And in lib/serializers.ts, serializeTrademark gains:
--
--   image_url: m.imageUrl ?? undefined,
--
-- The frontend type, the MarkTile component and every render site already
-- handle image_url and fall back to the plain tile while it is absent, so
-- promotion is the migration, the model field and that one serializer line.
--
-- The data patch for the seven marks is separate and comes with the verified
-- application-number to URL mapping. No URL is invented here.
