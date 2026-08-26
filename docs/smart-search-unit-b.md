# Smart Search, Unit B — the BrandVault client and UI

Built against §3 of `docs/smart-search-facade-contract-v1.md` (frozen v1, 8 Aug
2026) and a local mock of it. BrandVault never calls `api-live.lawpanel.com` and
holds no LawPanel key: it talks to the facade contract and nothing upstream.

Status: built, tested and proved against the mock. Not deployed, not merged, no
env set. The live swap is one environment variable, waiting on Unit A.

## What is here

| File | What it is |
| --- | --- |
| `lib/smart-search.ts` | The §3 client. Server-side only — holds the keys. Submit, poll, health. |
| `lib/smart-search-classes.ts` | Nice-class normalisation. Env-free so the browser shares it. |
| `lib/smart-search-poll.ts` | When to poll again and when to give up. Pure. |
| `lib/smart-search-notice.ts` | The AiLA Core hook: what a completed watch search emits, and what a clearance search does not. |
| `lib/clearance-link.ts` | Both ends of the mark → clearance link. Pure. |
| `app/api/smart-search/route.ts` | POST, submit a search. |
| `app/api/smart-search/[id]/route.ts` | GET, one poll. |
| `app/api/smart-search/[id]/notice/route.ts` | POST, emit `watch.notice`. Dark — nothing calls it. |
| `app/clearance/page.tsx` | The page. Tailwind. |
| `components/clearance/ResultsPanel.tsx` | The results, and the three other outcomes. |
| `mock/smart-search-facade.ts` | The disposable mock. Delete it when live works. |

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

## The four outcomes

Each is rendered as itself, which is the whole point of §3.3.

- **running** — the search is with the register. Polls to 90 seconds, then says
  it may still be running. Not "no results".
- **completed with hits** — verdict, score, mark, owner, classes and overlap,
  status, application number and date. Sorted by score.
- **completed with none** — "nothing similar found", read against the currency
  date. A clean result is a result.
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

## Open questions this build takes a position on

Answers belong to Unit A's first live smoke (§6); these are the readings taken
in the meantime, each in one place and cheap to change.

1. **Terminal status strings.** `normaliseResult` accepts `completed` and
   `failed` case-insensitively and reads *anything else* as `running`. A client
   that rendered an unknown string as "completed with no hits" would report an
   empty register where a search was still in flight. Running is the honest
   reading; the 90-second cap ends it.
2. **Facade polls upstream, BrandVault polls the facade.** Assumed throughout.
   No request thread ever blocks on an external job.
3. **`weighting`.** Never set. The §3.1 body has no such field, so BrandVault
   always takes the facade's default and the question stays upstream of the
   contract, where it belongs.
4. **Result cap.** No cap applied client-side. If Smart Search adopts the
   registry facade's refuse-with-count at 2000, the client will need the 413
   branch `getMarks` already has.
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
