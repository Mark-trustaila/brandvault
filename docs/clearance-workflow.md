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

**Vocabulary settled 31 August 2026:** the header action is *Registry search*,
the page heading *Registry search*, the nav entry *Registry searches*. The word
"clearance" no longer appears in any UI label or copy. It survives as the route
(`/clearance`), as the code identifiers, and as the name of the report templates
in §7.

Two header actions sit beside each other where actions live: Registry search and
New mark. Both take the same secondary outline style as Report and Settings —
no solid fill, no extra weight. No view has more than one filled button, and
this feature does not claim it; Run search on the form is the app's standard
button.

The nav entry is a noun, Registry searches, listing past searches. The same
table sits under the query box on the search page, so the two routes show the
same thing.

### The column system

Settled 31 August 2026. The three columns are a system, not a set of numbers.
The widths live once, in `app/globals.css` as custom properties, mirrored in
`lib/layout.ts` for documentation and tests, with a test holding the two to each
other.

The rail and the panel are separate widths. The rail is a column you read
alongside the centre; the panel is a column you read instead of it, and they
want different amounts of room.

Closed (nav / centre / rail):

| Viewport | Nav | Centre | Rail |
| --- | --- | --- | --- |
| 1280 | 240 | 720 | 320 |
| 1440 | 240 | 880 | 320 |
| 1680 | 240 | 1120 | 320 |
| 1920 | 240 | 1360 | 320 |

With a panel open, from 1320 up, where the rail column takes the panel's width
and the centre narrows to make room:

| Viewport | Nav | Centre | Rail |
| --- | --- | --- | --- |
| 1320 | 240 | 640 | 440 |
| 1440 | 240 | 760 | 440 |
| 1680 | 240 | 1000 | 440 |
| 1920 | 240 | 1240 | 440 |

Opening a panel is a change in the flow, not an overlay: the rail's own content
steps aside, the backdrop goes, and nothing is covered. The only edge that moves
is the one that is meant to.

1320 is the breakpoint precisely because it is where taking the panel's width
reaches the centre's floor: 1320 − 240 − 440 = 640. Below it, widening would
push the centre under, so the panel falls back to the slide-over it already was,
with its backdrop, over an unchanged rail. Below 1280 the rail leaves the flow
entirely.

The open rail takes `var(--panel-width)` rather than its own copy of 440, so
"the panel equals the open rail" holds by reference and cannot drift. The open
state is a single class on `AppShell`, so the rail's width, the rail's content
and the backdrop cannot disagree about whether a panel is open. Bree's floating
button offsets by the panel's variable, which is right whether the panel is in
the column or over it.

**One gap, flagged rather than built:** below 1280 the rail is out of the flow
and there is no control to summon its content. Panels still work; the rail's own
cards are simply not reachable at that width. A small trigger in the top bar
would close it.

**The page renders inside the application frame.** It shipped as a bare document
with a back link, which read as a different product rather than another room in
the same one. `components/layout/AppShell.tsx` — extracted from `app/page.tsx`,
which composed the frame inline — now owns the admin bar, sidebar, top bar,
right rail, the shared overlays and the portfolio fetch. Only the main content
area changes between pages, and there is no back link, because a page inside the
frame is not somewhere you go back from.

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

Reorder: up and down controls on rows in the highlight tier only; the order is
saved as `position`; "order by score" resets it. Built.

The list itself stays in the engine's order — the rank shown beside the tier is
where a move registers, rather than the row jumping out from under the cursor.
A move renumbers the whole tier rather than the pair that swapped: writing only
the pair would leave the rest holding whatever positions they had, and the
stored order would depend on the sequence of moves rather than on where things
ended up. Marks not yet placed keep the engine's order among themselves, after
the ones that have been.

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

Implementation note: `HitPanel` is its own component but uses
`DetailPanel.module.css` directly, so a result opens exactly as a portfolio mark
does — same position, width, backdrop, header and footer chrome, and close
behaviour, and it steps aside for the Bree panel identically. A lookalike would
drift the first time either was restyled. It stays a separate component because
`DetailPanel` is bound to `Trademark` and DashboardContext and shares no fields
with a search result; the stylesheet is shared, the data shape is not.

That is a deliberate exception to "new components use Tailwind". The point of
that rule is to stop the two styling systems mixing inside one component; this
one uses a single system, the existing one, because matching an existing surface
exactly is the requirement.

Nothing in the results list changes while the panel is open.

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

Slice 2: reorder (done); the report builder and UK template; the report route
and attachment.

The report half is not started, and needs two things that are not in the
codebase. The statutory sections and disclaimer wording come "from the sample
reports" (§7) — those have not been shared, and a clearance disclaimer is not
something to draft from memory. And attaching a generated report to a record is
a migration, which is gated.

Gates, as always on the live codebase: the migration (production database
write), any env change, merge. Build and test freely; stop at those.

**The migration was applied on 31 August 2026** with `prisma migrate deploy`
against the Azure database, and now sits in
`prisma/migrations/20260831120000_clearance_search`. Prisma's history holds the
row and `migrate status` reported the schema up to date. The run route has been
exercised on production: a brexit / class 25 / UK search wrote to
`clearance_searches` and reads back in the Registry searches list with 250 hits.

The browser leg is verified on app.getbrandvault.com after merge. Production
Clerk refuses non-branded origins, so neither localhost nor a preview URL can
sign in — a preview deploy does not close that gap and is not the route to it.

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
