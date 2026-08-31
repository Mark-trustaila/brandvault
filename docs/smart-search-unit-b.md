# Smart Search, Unit B — the BrandVault client and UI

> **Superseded in part by `docs/clearance-workflow.md` (31 Aug 2026).** The
> client, the contract reading and the facade findings below still hold. The
> page does not: a clearance search is now a saved record with a review
> attached, reached from a header action rather than the left nav, and the
> results table leads on score and drops similarity. Read that note for the
> current shape of the UI.

Built against §3 of `docs/smart-search-facade-contract-v1.md` (frozen v1, 8 Aug
2026) and a local mock of it. BrandVault never calls `api-live.lawpanel.com` and
holds no LawPanel key: it talks to the facade contract and nothing upstream.

Status: built, tested and proved against the mock. Not deployed, not merged, no
env set. The live swap is one environment variable, waiting on Unit A.

## What is here

| File | What it is |
| --- | --- |
| `lib/smart-search.ts` | The §3 client. Server-side only — holds the keys. Submit, poll, health. |
| `lib/smart-search-classes.ts` | Nice-class normalisation for a search being submitted. Env-free so the browser shares it. |
| `lib/smart-search-hit.ts` | The hit shape, and the accessors that absorb the facade's normalisation. Env-free. |
| `lib/smart-search-poll.ts` | When to poll again and when to give up. Pure. |
| `lib/smart-search-registries.ts` | Which registers are searchable, and what to call them. Pure. |
| `lib/smart-search-notice.ts` | The AiLA Core hook: what a completed watch search emits, and what a clearance search does not. |
| `lib/clearance-link.ts` | Both ends of the mark → clearance link. Pure. |
| `app/api/smart-search/route.ts` | POST, submit a search. |
| `app/api/smart-search/[id]/route.ts` | GET, one poll. |
| `app/api/smart-search/[id]/notice/route.ts` | POST, emit `watch.notice`. Dark — nothing calls it. |
| `app/clearance/page.tsx` | The page. Tailwind. |
| `components/clearance/ResultsPanel.tsx` | The results, and the three other outcomes. |
| `mock/smart-search-facade.ts` | The disposable mock. Delete it when live works. |
| `test/fixtures/smart-search-gb-asos.json` | A verbatim subset of a real search, captured 2026-08-28. The tests' witness. |
| `test/fixtures/smart-search-gb-truncated.json` | A real capped response: LONDON in class 35, captured from the deployed facade. |

Two existing files changed: `components/detail/DetailPanel.tsx` gains the
per-mark action, `components/layout/Sidebar.tsx` points its dimmed "Search" slot
at the new page.

## Running it

```
npm run mock:smart-search          # a facade on :8787

SMART_SEARCH_FACADE_URL=http://localhost:8787 \
SMART_SEARCH_FACADE_KEY=dev SMART_SEARCH_FACADE_FN_KEY=dev \
npm run dev
```

The mock is deliberately unhelpful in two ways, because a mock nicer than the
real thing hides work. Auth is enforced: both headers, on every call but health.
Searches take time: `running` for two polls before settling, so the polling loop
is exercised rather than skipped by an instant answer.

Triggers, so a state can be reached on purpose:

| Term contains | Outcome |
| --- | --- |
| `fail` | `status: "failed"` with a reason |
| `nothing` | completed, zero hits |
| anything else | completed, four hits across the similarity vocabulary |

## Two ways in

A mark: the detail panel's "Clearance search" button, which prefills the mark's
text, its own classes, and its application number as the provenance ref. A mark
with no verbal element does not offer the button — there is nothing to
text-match on, and searching for its application number would search for a
number nobody registered.

A term: the sidebar's "Clearance search", or `/clearance` directly.

## Which register

Selectable, GB and WO, GB by default — what the facade allows and what §3.1's
path parameter was always for. The earlier hardcoding to GB came from the
session brief's example rather than a decision.

The choice is a visible control, not an implied default, and every outcome names
the register it searched: the running state, the results header, the empty
state, the failure and the truncation notice. A clearance result read against
the wrong register is a false clear, so "nothing similar found" has to say where
nothing was found.

A prefill link carries the register too, taken from the mark's own filing where
that is one we can search. EUIPO and USPTO marks both appear in real portfolios
and neither register is searchable yet, so those propose GB rather than refusing
the action — safe only because the selector displays the choice before the
search runs. A link written before the register was selectable carries no
`registry` param and lands on GB, which is the register it always searched.

## The four outcomes

Each is rendered as itself, which is the whole point of §3.3.

- **running** — the search is with the register. Polls to 90 seconds, then says
  it may still be running. Not "no results".
- **completed with hits** — verdict, score, mark, owner, classes and overlap,
  status, application number and date. Sorted by score.
- **completed with none** — "nothing similar found", read against the currency
  date. A clean result is a result.
A fifth thing rides above the list when it applies: if the result set was
capped, a warning says so before the table, and the headline count changes to
match. A capped list that reads as a complete search of the register is a false
clear, which is the one wrong answer in clearance nobody catches, because the
lawyer acts on an absence that was never established.

Two variants, because there are two truths. When the facade counted the set and
capped it itself, the reader gets "showing 2,000 of 4,318" and knows exactly
what is missing. When upstream capped first — LawPanel returns at most 250 and
never says how many it found — `total_available` comes back null, and the notice
says only "showing 250: the register holds more matches than the search can
return", with the floor from `total_at_least` and the ceiling from
`upstream_cap`. The headline follows the same rule and never names a total it
does not have, because rendering `result_count` as a total turns "we could not
see the rest" into "there is no rest": a false clear with a number attached,
which reads as a finding.

- **failed** — the register was not searched. Rendered with its reason, never as
  an empty list: an empty list says "nothing like your mark is registered",
  which is the opposite of what a failure means and is the answer a lawyer would
  act on. The searcher worker has a documented history of failing.

`currencyDate` and `coverage` ride on every settled outcome, sourced from the
response and never assumed here, as the registry views do.

## The AiLA Core hook

Built to the Core contract §3 shape, dark until Core exists.

A completed *watch* search emits `watch.notice` — mark ref, a summary of the
form "3 very-high hits for BLOC", and a deep link to the result by search id.
A one-shot clearance search emits nothing: someone is standing there waiting,
and the answer is the screen. That split is enforced in `noticeFor`, which
returns null for a clearance search, so the only way to emit from one is to lie
about its kind.

A failed watch also emits nothing. `watch.notice` says something was found;
sending one carrying a failure would put "0 hits" in front of a reader when the
truth is "we did not look". Routing failures to Core is a separate event type
and a v1.x decision.

Dark, precisely: `lib/ailaCore.ts` is a no-op reporting `unconfigured` while
`AILA_CORE_URL` and `AILA_CORE_APP_KEY` are unset. No feature flag, and nothing
to remove when Core lands — two env vars and the same code delivers.

v1 ships one-shot clearance only. Nothing in the UI calls the notice route;
watch recurrence is v1.x (§6 q5), and its caller will be a scheduled run.

## Swapping to live

One variable, once Unit A hands Mark the deployed URL and key.

If Smart Search deploys beside the registry reads on the same host under the
same key — which §3 says it does — then `REGISTRY_FACADE_URL`,
`REGISTRY_FACADE_KEY` and `REGISTRY_FACADE_FN_KEY` are already in Vercel and
**nothing needs setting at all**. The client falls back to them.

If it lands on its own host or under its own key, set the three
`SMART_SEARCH_FACADE_*` variables (see `.env.example`). Mark sets env, via
`vercel env add`, Preview interactively, never piped; verify with
`vercel env ls`.

Then delete `mock/smart-search-facade.ts` and its `npm run mock:smart-search`
script. Nothing in `lib/`, `app/` or `components/` refers to it.

## What the first live search changed

Smoked against the facade running locally on 2026-08-28. Submit, poll, backoff,
the 90-second cap and the settle path all behaved: eight polls, 24 seconds, 206
real UKIPO hits. `mark_ref` is echoed on the poll, so a watch notice can anchor
from the facade's own response.

Three things the mock could not have caught, because it was written to the
contract's field names and therefore agreed with the client:

The facade normalises further than §3.2 spells out. It renames `mark_string` to
`mark`, turns the comma-string `classes` into an array, turns `class_match` into
a boolean, drops the top-level `id`, and preserves the whole §2.3 hit under a
`raw` key. §3.2 authorises exactly two normalisations — registry as a name,
application_date as a date — and calls the rest preserved, so on a strict
reading the facade deviates. It is also the better shape, and `raw` loses
nothing. `lib/smart-search-hit.ts` reads either form, so the argument needs no
resolution and no synchronisation point.

Score is a distance, not a similarity. ASOS scores 19 against its own term while
EZEEZ scores 50. The panel sorted descending and led a clearance search for ASOS
with EZEEZ, S8 and OSY. §2.3 calls score "the numeric basis" and never states a
direction, so the re-rank was a guess; the facade's own order now stands.

Two things for Unit A, documentation not code. The v1.1 review §8 says its
additions are "all additive, none replacing anything in the frozen shape", which
the wire contradicts — it should describe the normalised-view-plus-`raw` design
it actually built. And the score direction needs stating in words, since neither
document carries it.

## Open questions this build takes a position on

Answers belong to Unit A's first live smoke (§6); these are the readings taken
in the meantime, each in one place and cheap to change.

1. **Terminal status strings.** `completed` is now confirmed live.
   `normaliseResult` accepts `completed` and `failed` case-insensitively and
   reads *anything else* as `running`; the failure string is still uncaptured. A client
   that rendered an unknown string as "completed with no hits" would report an
   empty register where a search was still in flight. Running is the honest
   reading; the 90-second cap ends it.
2. **Facade polls upstream, BrandVault polls the facade.** Assumed throughout.
   No request thread ever blocks on an external job.
3. **`weighting`.** Never set. The §3.1 body has no such field, so BrandVault
   always takes the facade's default and the question stays upstream of the
   contract, where it belongs.
4. **Result cap.** Settled, and the §7 "suspicious 250" is confirmed: upstream
   caps at 250 and does not report how many it found. The facade reports
   `result_count`, `total_available` (null when upstream capped), `total_at_least`,
   `upstream_cap`, `cap` and `truncated`; the panel warns above the list when
   `truncated` is exactly true, in whichever of the two variants applies.
   Captured live on 2026-08-28 against the deployed facade (tip 42e1bc9):
   LONDON in class 35 settled in 23 seconds and returned the capped shape
   exactly — `completed 250 None 250 250 True`. The fixture is that response.
5. **Watch semantics.** One-shot only. `noticeRef` is the search id, so two runs
   against one mark stay distinct in the feed rather than collapsing.

## Decisions worth a second look

- **Viewers can run a clearance search.** `app/api/smart-search/route.ts` is the
  fourth `allowViewer: true` opt-out from the viewer write gate. A search writes
  nothing and is a POST only because a term and a class list need a body — the
  same reason `/api/bree` is on that list. Gating it would mean a viewer-seat
  lawyer cannot run a clearance search, which is most of the reason they would
  open BrandVault. `test/viewer-write-gate.test.ts` pins the list, so reversing
  this is a one-line change in two files.
- **30 searches per company per hour** (`SMART_SEARCH_LIMIT`, beside the import
  limits in `lib/import-events.ts`). Clearance is iterative; imports are not.
- **Nothing is persisted.** No Prisma migration, no new table. The facade holds
  the search and BrandVault holds an id for as long as the tab is open. Saved
  searches and watch history are what v1.x recurrence will need, and that is the
  right time to decide their shape.
