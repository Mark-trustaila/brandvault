# Clearance search workflow — design note

Settled by Mark, 31 August 2026. Slice 1 is built; slice 2 is the report.
Builds on `docs/smart-search-unit-b.md` and
`docs/smart-search-facade-contract-v1.md`, and changes nothing in the facade
contract.

## 1. What changes and why

The clearance search shipped as a page reached from the left nav. A search
result is the middle of a lawyer's job, not the end: they open hits to read the
specification and owner, decide which matter, and often circulate a report with
a short table of marks of interest and a schedule of everything found. The
search must therefore become a saved record with a review attached, reachable
from where the work happens, and able to produce that report.

Two facts from the engine review inform the panel: the LawPanel `score` is the
only similarity measure (0 = identical, lower is closer) and the `similarity`
string is a bucketed edit distance with known bugs. The panel leads on score and
drops similarity.

## 2. Navigation and entry points

The left nav entry "Clearance search" goes. Two header actions sit beside each
other where actions live, styled as the existing New mark button: Clearance
search and New mark. They are independent; neither requires the other.

The nav gains a noun, Clearances, listing past searches (§5). The same table
sits under the query box on the search page, so the two routes show the same
thing.

Entry points into a search: the header action (blank form); a mark's detail
panel action "Check register" (prefilled, mark_ref set, as `clearanceHref`
already does); a row in the Clearances table (reopens the saved record). Keep
`/clearance` as the route; it now renders the search page with the history
table, and `?search=` reopens a saved record.

## 3. The saved search record

A search is a record from the moment it runs, company-scoped like every other
table. Prisma, MySQL, additive migration. See `prisma/schema.prisma` for
`ClearanceSearch` and `ClearanceHitReview`.

The hit snapshot is stored whole, including hits later excluded: the register
moves, and the evidence of what was seen and dismissed on the day is part of the
record. Tier and note live in the review table so the snapshot is never edited.
Excluded hits stay in the snapshot and are simply not included in reports.

Routes (all under the existing viewer write gate; viewers can read a saved
search, cannot run, review or report):

    POST  /api/clearance              run and save
    GET   /api/clearance?q=&limit=    history, filtered by term, class,
                                      registry, user
    GET   /api/clearance/{id}         record + reviews
    PATCH /api/clearance/{id}/hits    bulk tier, note, position updates
    POST  /api/clearance/{id}/report  slice 2

The 30-per-hour rate limit stays on the run route, sharing one budget with
`/api/smart-search` rather than granting thirty each.

One route was added beyond this list. `GET /api/registry/mark` proxies the
registry facade for §5's specification and owner lookup: the browser cannot
reach the facade, which holds two secrets.

## 4. Results panel

Columns, in order: score, mark and owner, classes with the class-overlap marker,
status, application number and date, tier. No similarity column, no results-count
headline, no truncation rubric. When `truncated` is true, one line under the
table. Default order is the facade's own (by score, exact matches first); the
exact match (score 0) is marked as such.

Note on the marker: score 0 is the engine's identical *bucket*, not string
equality — the real LONDON capture scores `@LONDON` at 0 alongside `LONDON`. The
chip therefore claims what the engine claims, which is what a report should
repeat.

Selection is transient: a checkbox per row plus quick-select buttons (all, live
only, class overlap, score under a threshold, none). Its only use is to apply a
tier to the selected rows in one action from the toolbar. What persists is the
tier, never the tick.

Reorder (slice 2): up and down controls on rows in the highlight tier only; the
order is saved as `position`; "by score" resets it.

## 5. Opening a hit

A hit opens in the right-hand panel, following the `DetailPanel` pattern the
portfolio uses for a mark. Previous and next controls in the panel header (and
arrow keys) walk the list without returning to it.

Contents, in order: mark, owner, status, filed and renewal dates, application
number; the full goods and services specification per class, from
`GET /registry/{registry}/mark/{applicationnumber}` via `lib/registry-facade.ts`
(already deployed; GB only today); the owner's other marks from
`GET /registry/{registry}/search-by-owner`; the deep link to the register; then
the review controls — tier (three buttons) and note (textarea), saved on change
to `ClearanceHitReview`.

For WO hits, where the facade has no mark read yet, the panel shows the hit as
returned by the facade plus the deep link, and says the specification is not
available for this register. No silent blanks.

Implementation note: this is its own component rather than an extension of
`DetailPanel`. That component is CSS Modules and bound to `Trademark` and
DashboardContext; a clearance hit is a different entity from a different source
and shares no fields, so extending it would have put two data shapes in one
component. The pattern is reused; the code is not shared.

## 6. Clearances table

Under the query box, and as the nav page: term (with a "from mark" marker when
markRef is set), register, classes, run date and user, hit count, report state
(none, draft, issued). A text filter matches term, class, registry and user.
Clicking a row reopens the record with its tiers, notes and order as saved; it
does not re-run the search. Re-running is an explicit action in the record,
producing a new record linked to the old via `rerunOfId`.

Report state is `none` for every record until slice 2 builds the report.

## 7. Report (slice 2)

Generated from the record and its reviews, as docx (the `docx` package; PDF from
it later), attached to the record, versioned by generation time. Structure
mirrors the firm's existing search reports: header (date searched, mark,
register, classes, data as at `currencyDate`); a sentence on whether an
identical mark was found; the marks-of-interest table (highlight tier, in saved
order); analysis sections; disclaimer; appendix (appendix tier, by score).

Templates per register carry the statutory sections and disclaimer wording; UK
first (relative grounds s.5 and absolute grounds s.3, Trade Marks Act 1994), NZ
and AU to follow from the sample reports. A "plain" variant drops the statutory
sections for non-lawyer readers. Analysis paragraphs are editable text fields in
the app, seeded from the template; any AI drafting of them is a later decision
and not part of this build.

Every generated value comes from the record, never typed twice, so a report
cannot carry another search's mark or country.

## 8. Slices and gates

Slice 1 (this PR): the record and migration; the run, history, read and review
routes; header actions and nav change; the panel cleanups (§4 except reorder);
the hit panel (§5); the Clearances table (§6); the `/clearance` route changes.
Tests pin the migration shape, company scoping, the viewer gate, tier
application in bulk, and that the snapshot is written whole and never mutated by
review.

Slice 2: reorder; the report builder and UK template; the report route and
attachment.

Gates, as always on the live codebase: the migration (production database
write), any env change, merge. Build and test freely; stop at those.

**The migration is staged and unapplied.** It sits in
`prisma/migrations-pending/20260831120000_clearance_search`, where
`prisma migrate deploy` cannot reach it. Until it is promoted, `/api/clearance*`
returns a 500 naming the missing table and nothing else is affected — both
tables are new, so no query that works today gains a column it cannot find.

## 9. What is not in scope

Watch searches and recurrence; `watch.notice` emission (Unit C, when Core
exists); AI-drafted analysis; EU and US registries at the facade; the BrandVault
LawPanel tenant swap. If a generated report should count as work performed for
AiLA Core's weekly report, that is a `work.performed` emission per the Core
contract and a one-line addition later.

## 10. Conventions

Company scoping on every query; the viewer write gate on every write; existing
components before new ones; no new dependency for slice 1. Copy in Economist
house style: British English, sentence case, no bold, "lawyer" never "attorney",
plain statements of what the product knows and does not know.

Note on §10 as written: it named `RowCard` and `SectionHead` as existing
components to reuse. Neither exists in this repo, nor in the sibling prototypes.
`DetailPanel` and `StatusBadge` do, and the pattern of the former is followed by
the hit panel. Flagged rather than invented.
