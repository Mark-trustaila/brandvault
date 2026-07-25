# Handoff: Portfolio Import feature — registry-sourced portfolio creation

For: BrandVault project (repo: brandvault-asos, plus a small registry-side facade).
From: the UK registry restore workstream, 2026-07-25.
Status of source data: proven pipeline, two registry-side jobs still landing (see Timing).

## 1. What this feature is

A user types their company name into BrandVault → BrandVault searches the UK trademark
register by proprietor → shows the matched owner names as checkboxes → previews the marks
→ user confirms → their real portfolio is imported, with deadlines generated. This replaces
manual portfolio entry and is the product's core onboarding moment.

Everything hard about this was solved and reviewed during the ASOS demo build (July 2026).
This project is assembly, not invention.

## 2. What already exists (starting material)

All on branch demo/real-gb-data in brandvault-asos (merge to main first if not yet done):

- scripts/load-gb-export.ts — the loader: parses a registry export, maps to the Prisma
  schema, generates children, loads. Ran once in production and hit its predicted counts
  exactly (222 marks, 999 goods/services, 294 deadlines). Promote this from one-off script
  to a service function parameterised by owner; keep its abort-on-unmapped-status behaviour.
- scripts/recon-firms.ts — read-only diagnostics; useful as a test harness.
- prisma: trademarks.registry_status_raw column live in the DB and schema — verbatim
  registry status preserved beside the mapped 5-value MarkStatus enum. Keep this pattern.
- Reviewed transform decisions (do not re-litigate; they were lawyer-approved):
  - Status map: Registered→Registered, Withdrawn→Abandoned, Application Published→Published,
    Examination→Pending. Wider registry vocabulary (Dead/Removed/Opposed) will appear in
    future imports: extend the map with the same rules — total, conservative (keep renewal
    obligations visible when ambiguous), lossless via registry_status_raw. Unmapped values
    ABORT the import, never default.
  - Dates: take the registry's calendar date, pin to UTC midnight (avoids the +01:00
    timezone shifting filings back a day — 96/173 ASOS marks were affected).
  - Device marks (no verbal element): mark_text = "[device mark, no verbal element]
    <application number>" so every view renders something identifiable.
  - Deadlines: generated only for live statuses (gate in the loader; the obligation engine
    itself has no status gating — logged as a known issue in the repo CLAUDE.md).
  - familyId: never inferred on import (families are explicit user-created entities).
  - clientAgentName: null on import (no register equivalent).
- On the registry side: ~/lawpanel/scratch/exports/asos-gb-20260724.json shows the raw
  export shape, and REGISTRY-REBUILD-RUNBOOK.md (project knowledge in the registry
  project) is authoritative for registry state.

## 3. What to build

### 3a. Registry read facade (registry side, small)
Do NOT use the Firms API (api.lawpanel.com) — dead cert, docket-shaped, wrong source
(recon report, 2026-07-24). Do NOT hit BaseX REST directly from the app tier in
production. Build a thin facade in front of BaseX:
- POST /registry/gb/search-by-owner  { query } → matched owner strings + counts
- POST /registry/gb/marks            { ownerStrings[] } → full mark documents (the
  export JSON shape)
- GET  /registry/gb/mark/{applicationNumber} → one document
Wraps existing XQuery in /data/basex/webapp/gb.xqm (gb:SearchByApplicantRepresentative
already does the owner search; note the deployed gb:trademark-details has a known
one-char bug, GBmark-text vs GB-mark-text — fix when touching that file).
Auth: single API key for BrandVault, server-side only. Result cap: refuse or paginate
owner queries matching > ~2,000 marks (protects the shared BaseX lane).
Hosting: Azure Function or small service near the data VM; BrandVault's backend is its
only consumer for now.

### 3b. Import flow (BrandVault repo)
1. Search box: user enters company name → facade search-by-owner → render matched owner
   strings as CHECKBOXES with per-string mark counts. This is not cosmetic: the ASOS
   export matched "ASOS plc", "ASOS HOLDINGS LIMITED", an unrelated "Shenzhen asos
   E-Commerce Ltd." (full-text tokenisation), and 25 marks where ASOS was merely the
   representative. Owner-vs-representative matches must be visually distinct; default
   representative-only matches to unchecked.
2. Preview: counts by status and series (UK000/UK008/UK009), sample marks, then confirm.
3. Import: the promoted loader runs server-side. Idempotent by application number —
   re-importing refreshes existing marks rather than duplicating.
4. Post-import: portfolio view with an "as at" date (see 3d).

### 3c. Loader promotion
- Same transform, same gates, parameterised by owner strings + company.
- Write plan discipline survives in code form: compute predicted counts, load, verify
  actuals match, report/rollback on mismatch. Keep an export snapshot per import (the
  rollback-material pattern from the demo load).
- All writes through Prisma inside a transaction per import.

### 3d. Honesty guardrails (product copy, not engineering)
- Every imported portfolio shows "UK registry data as at <date>" — sourced from the
  facade (the corpus currency date), not assumed.
- Until the UK009 extract ingest completes registry-side: comparable-mark coverage is
  partial (~72%); absence of a UK009 mark is not proof of non-existence. Word the
  preview accordingly; remove the caveat when the registry side confirms completeness.
- Live marks only: the owner index does not return dead/expired marks, so imported
  portfolios contain no lapsed-mark history. Do not imply otherwise in copy.
- Non-UK registries: not registry-synced. Marks in other jurisdictions are
  user-maintained records; label provenance per mark (registry-synced vs manual).

## 4. Timing dependencies (registry side, in flight)

Build now; launch after these two land (days–weeks, both already executing):
1. Catch-up swap: GB moves from current-to-2026-07-11 to current-to-date, then a daily
   WebJob keeps it current. The facade's "as at" date makes this transparent.
2. UK009 baseline ingest: the UKIPO has fixed extract permissions and offered the full
   ~1M Brexit comparable set; once ingested, the 72% caveat in 3d is removed.
Confirm both with the registry project before public launch.

## 5. Boundaries and gates

- The shared Azure MySQL serves preview AND production: any migration follows the
  staged-outside-migrations → reviewed → applied → resolve pattern used for
  registry_status_raw. No destructive migration without an explicit human go.
- The facade is read-only against BaseX. Nothing in this feature writes to any registry
  database, ever.
- Imports are per-company-scoped writes to BrandVault's own DB only.
- Respect repo rules in CLAUDE.md (never merge records; three required fields;
  reason-required edits; families explicit).

## 6. Open questions for the product owner (decide during build)

1. Facade hosting choice (Azure Function vs small always-on service) — cost vs cold-start.
2. Result-cap UX for very large proprietors (paginate the preview vs "contact us").
3. Whether representative-only marks are importable at all in v1, or shown-but-disabled.
4. Refresh model: manual "re-sync" button in v1 (recommended) vs scheduled per-portfolio
   sync (later, once the WebJob pattern is proven registry-side).

---

Decisions since handoff (2026-07-25, product owner):
- Q1: Azure Function.
- Q2: "contact us" / refuse with count shown. No pagination.
- Q3: shown-but-disabled in v1.
- Q4: manual re-sync in v1.
- Sequencing: admin entry point ships live first (concierge accelerator); self-serve
  entry built dark behind SELF_SERVE_IMPORT — see docs/self-serve-import-spec-v1.md.
- Facade takes registry as a path parameter from day one; gb only implemented now.
