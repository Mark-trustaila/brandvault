# Pending migrations — staged, deliberately not applied

Migrations placed in this directory are **prepared for review and cannot be
applied by accident**. `prisma migrate deploy` only reads `prisma/migrations/`,
so nothing here runs until it is explicitly promoted.

Why the separate directory: Preview and Production currently point at the **same
Azure MySQL database** (see the root `CLAUDE.md` env table). A migration sitting
in `prisma/migrations/` is one stray `npm run db:deploy` away from altering
production. Staging it here removes that path entirely.

**Staged now:** `20260831120000_clearance_search` — the `clearance_searches` and
`clearance_hit_reviews` tables for the clearance workflow
(`docs/clearance-workflow.md` §3). Both are new tables; nothing existing gains a
column, so the unapplied state cannot break a query that works today. The
consequence of leaving it unapplied is bounded and loud: `/api/clearance*`
returns a 500 naming the missing table, and nothing else is affected. The
schema.prisma models and the generated client are merged ahead of the DDL so the
routes compile — which is safe here precisely because these are new tables, and
would not be for a new column on an existing one.

## Promotion sequence

For any migration staged here, all steps need explicit approval:

1. Apply the DDL to the target database (`npx prisma db execute --url "$DATABASE_URL"
   --file <dir>/migration.sql`).
2. Apply the matching model patch to `prisma/schema.prisma`, then
   `npx prisma generate`.

   **Steps 1 and 2 must not be separated by a deploy.** Prisma Client generates
   an explicit column list for every query, so a model declaring a column the
   database lacks makes a bare `findMany()` fail with `Unknown column` — and on
   this project a preview build queries the production database.
3. Move the directory into `prisma/migrations/` and run
   `npx prisma migrate resolve --applied <migration_name>`.

   Do not skip this. Applying DDL out of band leaves Prisma's migration history
   ignorant of the change; `prisma migrate dev` then reports drift and offers to
   **reset the database**, which on a shared production instance is the worst
   available outcome.

## History

- `20260831120000_clearance_search` — **STAGED, awaiting approval.** Two new
  tables for the clearance record and its per-hit review.

- `20260725140000_trademark_image_url` — nullable `trademarks.image_url` for
  device-mark images. Approved and promoted 2026-07-25 as
  `prisma/migrations/20260725140000_trademark_image_url`; the seven URLs were
  loaded by `scripts/load-device-images.ts`.
- `20260725120000_watch_notices` — `watch_notices` table for third-party
  filing notices. Approved and promoted 2026-07-25 as
  `prisma/migrations/20260725120000_watch_notices`.
- `20260725130000_deadline_reconciliation` — provenance columns on
  `deadlines`. Approved and promoted 2026-07-25 as
  `prisma/migrations/20260725130000_deadline_reconciliation`.
- `20260724_trademark_registry_status_raw` — added
  `trademarks.registry_status_raw VARCHAR(191) NULL` to hold verbatim registry
  status alongside the mapped `MarkStatus` enum. Approved and promoted
  2026-07-24 as `prisma/migrations/20260724120000_trademark_registry_status_raw`.
  See `docs/gb-load-plan.md`.
