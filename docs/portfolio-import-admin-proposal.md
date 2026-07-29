# Portfolio import — admin UI component plan + schema additions (PROPOSAL, staged for review)

Status: **proposal, not built.** The one document owed before UI work starts
(per the handoff). Schema additions are staged in
`prisma/migrations-pending/20260729120000_portfolio_import/` — reviewed and
promoted before any code depends on them. Branch: `feature/portfolio-import`
(nothing merges to `main` during the YC review window without per-merge sign-off).

## 0. What already exists on this branch (the milestone just built)

- `lib/registry-facade.ts` — server-side client (proven live: 19/19).
- `lib/import-portfolio.ts` — the import transaction: `prepareImport` →
  `commitImport`. All five loader gates preserved (abort-on-unmapped,
  predicted-vs-actual verify-or-rollback, snapshot as rollback material, one
  transaction, idempotent by application number via in-place update).
- `scripts/import-portfolio.ts` — CLI (dry-run default; `--write`; `--prune`);
  writes the snapshot to `import-snapshots/<slug>-<ts>.json` before any write.

The service uses **only the current schema** (it must — preview and prod share
one DB and no migration is applied). Everything below is what the **admin UI**
needs on top, plus the schema that makes the import durable and safe at scale.

## 1. Sequencing (from the handoff decisions)

1. **Admin entry ships first** — the concierge accelerator. A platform-admin
   imports a client's portfolio on their behalf. Lowest risk, no self-serve
   surface, exercises the whole path with a human in the loop.
2. **Self-serve** is built dark behind `SELF_SERVE_IMPORT`
   (`docs/self-serve-import-spec-v1.md`) — same server actions, a customer-facing
   entry. Not in this proposal's build scope.

## 2. Component plan (admin concierge)

All facade/DB calls are **server-side** (Next server actions or route handlers);
the two facade secrets and `DATABASE_URL` never reach the browser. Auth: the
existing platform-admin gate (`scripts/set-platform-admin.ts` / `lib/authz.ts`).

### 2a. Server actions (the whole API surface — thin wrappers over lib/)

| Action | Wraps | Returns |
|---|---|---|
| `searchOwner(query)` | `registry-facade.searchByOwner` | owner rows (owner-vs-rep, counts), currency, coverage, cap |
| `previewImport(companySlug, ownerStrings)` | `import-portfolio.prepareImport` | predicted counts by status/series, plan (insert/update/stale), sample marks, currency, coverage — **no write** |
| `executeImport(companySlug, ownerStrings, {prune})` | `import-portfolio.importPortfolio` + persist to `portfolio_imports` | import event id, written/verified counts |
| `listImports(companySlug)` | `portfolio_imports` query | import history rows |
| `rollbackImport(importId)` | reads snapshot/pre-image, restores in a transaction | result |

`previewImport` and `executeImport` enforce the **rate limit** (§3.3) before
touching the facade — refuse with the window reset time.

### 2b. UI components (admin route, e.g. `app/(admin)/import/`)

1. **CompanyPicker** — select an existing company or create one (slug + name).
2. **OwnerSearch** — text box → `searchOwner`. Renders **OwnerCheckboxList**:
   one row per matched owner string with its mark count. Owner matches and
   representative matches are **visually distinct**; representative-only rows
   **default unchecked** (the ASOS case: `ASOS plc`/`ASOS HOLDINGS LIMITED`
   checked, rep-only `ASOS PLC` unchecked, unrelated `Shenzhen asos…` shown but
   for the admin to judge). Shows the cap; if a single owner exceeds it the row
   is flagged "too large — contact us" (no import).
3. **ImportPreview** — on selection → `previewImport`. Shows counts **by status
   and by series (UK000/UK008/UK009)**, the plan (N new, N refreshed, N marks
   already held that this import doesn't cover), sample marks, and the honesty
   banners (§2c). A **Confirm** button.
4. **ImportResult** — after `executeImport`: written/verified counts, link to the
   import event.
5. **ImportHistory** — `listImports`: table of prior imports (when, who, owners,
   counts, status) with a **Rollback** action per row.

### 2c. Honesty guardrails (product copy — driven by facade data, not hardcoded)

Sourced from every payload's `currencyDate` / `coverage`, so they flip
automatically when the registry side advances:

- Every imported portfolio and the preview show **"UK registry data as at
  `<currencyDate>`"** (today 2026-07-11).
- While `coverage.uk009.partial` is true: **"comparable-mark coverage is partial
  (~72%); absence of a UK009 mark is not proof of non-existence."** Removed when
  the registry side flips the flag after the UK009 ingest.
- **Live marks only** — the owner index returns no dead/expired marks; imported
  portfolios carry no lapsed-mark history. Copy must not imply otherwise.
- **Non-UK registries** are not registry-synced — label provenance per mark
  (registry-synced vs manual) once multi-registry lands.

## 3. Schema additions (APPLIED + promoted 2026-07-29 — `prisma/migrations/20260729120000_portfolio_import/`)

Preflight gate passed (`scripts/preflight-unique-index.ts`: 225 marks, 0 null
app-numbers, 0 duplicate `(company, registry, appno)` groups). DDL applied to the
shared Azure DB, `schema.prisma` patched (unique index + two models), Prisma
Client generated, dir promoted from `migrations-pending/`, `migrate resolve
--applied` recorded — `migrate status` = up to date, no drift. One correction
during apply: the two new tables needed `DEFAULT CHARSET utf8mb4 COLLATE
utf8mb4_unicode_ci` to match `companies.id` so the FK was accepted.

### 3.1 Idempotency as a DB invariant — unique index

```sql
CREATE UNIQUE INDEX `trademarks_company_registry_appno_key`
  ON `trademarks` (`company_id`, `registry_name`, `application_number`);
```
`import-portfolio` already matches on this triple in application code and is
correct without the index; it makes the guarantee a database invariant, enables a
true Prisma `upsert`, and blocks concurrent double-insert. Nullable
`application_number` → MySQL allows multiple NULLs, so hand-entered marks are
unconstrained.

schema.prisma patch (on promotion): add to `model Trademark`
```prisma
  @@unique([companyId, registryName, applicationNumber], name: "trademarks_company_registry_appno_key")
```

### 3.2 Import event log — `portfolio_imports`

One row per import: owner strings, currency date, predicted/actual counts, plan,
status (`committed`/`failed`/`rolled_back`), and the **snapshot** (rollback
material) either inline (`snapshot` JSON) or offloaded to blob (`snapshot_ref`).
FK to `companies` (cascade). Powers `listImports` and `rollbackImport`, and moves
the snapshot off the local filesystem (which is ephemeral on Vercel — the CLI's
`import-snapshots/` file only works for the script path).

New Prisma model `PortfolioImport` (fields mirror the SQL) + relation
`portfolioImports PortfolioImport[]` on `Company`.

### 3.3 Rate-limit state — `import_rate_limits`

`scope` (e.g. `company:asos-plc`) / `window_start` / `count`. The import action
is the expensive one (fans marks out of the shared BaseX lane), so it is
throttled per company/user, above and beyond the facade's per-request cap.
Manual "re-sync" in v1 → a small window (e.g. a few imports/hour/company) is
enough.

New Prisma model `ImportRateLimit`.

## 4. How the built service uses these once promoted

- **3.1** — `commitImport` can switch its per-mark `update`/`createMany` to a
  single `upsert` keyed on the unique index (fewer round trips, race-safe). The
  in-place-update semantics (preserve mark id + user notes) are unchanged.
- **3.2** — `executeImport` writes a `portfolio_imports` row (status +
  predicted/actual + snapshot) in the same logical operation; the CLI's file
  snapshot becomes the fallback for the script-only path. `rollbackImport` reads
  `snapshot.preImage` and restores.
- **3.3** — `previewImport`/`executeImport` check and increment the window first.

## 5. Decisions (resolved 2026-07-29)

1. **Snapshot storage** — **inline JSON, 5 MB threshold; blob deferred to
   volume.** `executeImport` inlines `portfolio_imports.snapshot` when the
   serialized snapshot is < 5 MB; above it, the inline snapshot is omitted (a
   marker recorded) until the blob path is built. `snapshot_ref` column is
   reserved for that deferred blob work.
2. **Absent-mark policy** — **keep-and-report-stale stands.** Deletion is a
   human decision; `--prune` (CLI) / `prune:true` (action) stays manual. The
   admin UI surfaces stale marks and lets the admin choose per import.
3. **Rate-limit window** — spec defaults stand (per
   `docs/self-serve-import-spec-v1.md`).
4. **Move `gb-transform` to `lib/`** — **done** (`lib/gb-transform.ts`); all
   importers updated.

The staged migration was **applied and promoted 2026-07-29** — see §3 note.

## 6. Not in scope here

Self-serve entry (behind `SELF_SERVE_IMPORT`), multi-registry (facade is `gb`
only), and the write path's live proof against the shared DB (gated — offered as
a dry-run on request; the client round-trip is already proven live).
