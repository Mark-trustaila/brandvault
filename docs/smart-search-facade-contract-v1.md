# Smart Search facade contract, v1 (draft for review)

Status: draft. Freezes on Mark's approval, then additive (v1.x) and versioned,
per the registry-facade convention. Captured live from tmd.lawpanel.com on
2026-08-10 (HAR).

## 0. What this is

BrandVault gains a trademark clearance / watch search: for a mark (or an
arbitrary term), run a similarity search against a register via LawPanel's
existing Smart Search engine, and surface structured hits. The engine is
LawPanel's and works; BrandVault consumes it, does not reimplement it.

The upstream API is `https://api-live.lawpanel.com/v1`, fronted by Azure API
Management (subscription key auth). Search is asynchronous: submit → poll
status → fetch results.

## 1. Build shape — designed for parallel sessions

Three independent build units. Units A and B share only this frozen contract,
so they can be built simultaneously in separate sessions on separate repos,
each wide-open per the autonomy rules, meeting only at the contract.

- **Unit A — the facade capability** (repo: the existing registry-facade,
  `~/lawpanel/registry-facade`). Adds a `smart-search` capability beside the
  existing registry reads. Owns the async submit-poll-results loop against
  `api-live.lawpanel.com` using BrandVault's own LawPanel tenant key. Exposes
  the settled BrandVault-facing contract in §3. New-codebase-adjacent
  (additive to a deployed service) — gate only on: deploy, the tenant key into
  env, and any APIM/network change.
- **Unit B — the BrandVault client + UI** (repo: `brandvault-asos`). Adds the
  per-mark "run search" action, the client library against §3 (mock the facade
  until A is deployed — the contract is the interface, the mock is disposable,
  exactly as the portfolio-import client was built against a local mock first),
  the results panel, and the notification/event wiring. Live codebase — gate on
  writes, deploy, merge.
- **Unit C — the AiLA Core event** (repo: `aila-core`, when it exists). A
  completed watch search emits a `watch.notice` event per the Core contract.
  Independent; can follow A and B or wait for Core. Documented here so A/B build
  the emit hook to the right shape.

A session on A and a session on B run at once. B builds against the §3 mock and
swaps to live when A hands over the deployed URL + key — the one synchronisation
point, routed through Mark, not session-to-session.

## 2. Upstream API (LawPanel v1) — as captured

Reference only; BrandVault never calls this directly (Unit A does). Auth:
`?subscription-key=<BrandVault tenant key>` (APIM). BrandVault uses its OWN
LawPanel tenant key and its own `search_origin_id`, never TMD's.

### 2.1 Submit
`POST /v1/search/add`
Request:
```json
{ "search_term": "blah", "classes": "2", "registry": "GB",
  "weighting": "", "search_origin_id": <BrandVault's id> }
```
`classes` is a comma-string ("2" or "35,36,42,45"). `registry` accepts the
short code ("GB") on submit. Response (job created):
```json
{ "id": "<uuid>", "search_term": "...", "classes": "2",
  "status": "Waiting", "similarity": null, "score": 0,
  "type": "Intelligent", "registry": 112, "registries": [] }
```
NB the response echoes `registry` as an integer code (112 = UKIPO) though
submit took "GB". See §5 registry mapping.

### 2.2 Poll
`GET /v1/search/{id}/status` → a bare JSON string. Observed: `"Waiting"`,
`"Searching"`. Terminal values to confirm at build (§6 open q1): expected
`"Completed"` and a failure value (`"Failed"` seen in the UI list). Poll is the
only way to know a search finished; there is no push.

### 2.3 Results
`GET /v1/search/{id}/results` → array of hits:
```json
[{ "id": "<uuid>", "score": 17, "similarity": "Very high",
   "class_match": 1, "application_number": "UK00004300780",
   "classes": "2,9,16,20,35,38,41,42", "status": "Registered",
   "mark_string": "BLOC", "registry": "112",
   "registry_official_name": "UKIPO", "is_registered": true,
   "application_date": "2025-11-25T00:00:00Z",
   "owner": "Bloc Services Group Limited", "mark_id": 0 }]
```
`similarity` verdict is server-computed ("Very high" / "Low" / …). `score` is
the numeric basis. `class_match` flags class overlap.

### 2.4 Reference lookups
- `GET /v1/registries` → the registry code map (fetch and cache; do not
  hardcode 112). BrandVault tenant creation should capture this.
- `GET /v1/search/filters` → filter metadata (not needed for v1 submit).

## 3. BrandVault-facing contract (what Unit A exposes, Unit B consumes)

The facade hides the async loop. BrandVault sees a clean submit-and-result.

### 3.1 Submit
`POST /smart-search/gb/search` (registry as path param, gb + wo to start —
mirrors the registry-facade path convention)
Auth: `X-BrandVault-Key` + Function key (same scheme as the registry facade).
Body: `{ "term": "...", "classes": ["35","36"], "mark_ref": "<optional
BrandVault mark id for provenance>" }`
Returns: `{ "search_id": "<facade id>", "status": "running" }`

### 3.2 Poll (or the facade resolves synchronously up to a cap)
`GET /smart-search/{search_id}` →
`{ "status": "running" | "completed" | "failed", "term", "classes",
   "registry", "currencyDate", "results": [ ... ] | null,
   "failure_reason": null | "<string>" }`
Results, when present, are the §2.3 hits normalised: registry as a name not a
code, application_date as a date, and the raw upstream fields preserved. Design
choice (§6 open q2): whether the facade polls upstream itself and BrandVault
polls the facade, or the facade blocks up to N seconds and returns settled.
Recommend: facade owns polling, BrandVault polls the facade — never blocks a
request thread on an external async job.

### 3.3 Honesty and failure
- Every response carries `currencyDate` + `coverage`, as the registry facade
  does — the corpus behind Smart Search is the same BaseX estate.
- A failed upstream search returns `status: "failed"` with a reason, never a
  silent empty result. (The UI capture showed real "Failed" rows; failure is a
  first-class state, not an exception. The searcher worker role has a
  documented history of failing — surface it truthfully.)
- Health: `GET /smart-search/health` anonymous, returns reachability +
  currencyDate.

## 4. Auth and tenancy

- BrandVault has its OWN LawPanel tenant (Mark is creating it) with its own
  subscription key and `search_origin_id`. Unit A holds the key server-side
  (env, Sensitive, by Mark's hands). It never appears in BrandVault's client or
  in any repo.
- The TMD subscription key seen in the capture is TMD's, is now exposed, and
  should be rotated by Mark independently — it is not used here.
- BrandVault → facade auth is the registry facade's existing scheme
  (X-BrandVault-Key + Function key), so BrandVault's client already knows it.

## 5. Registry mapping

Submit takes short codes ("GB", "WO"); responses echo integer codes (112 =
UKIPO). Unit A fetches `/v1/registries` at deploy, caches the full map, and
translates both directions so the BrandVault contract speaks only in names
(gb, wo, eu). Do not hardcode 112 — capture the map from the tenant.

## 6. Open questions to settle at build (do not block the freeze)

1. Terminal status strings from `/status` — confirm the exact "Completed" and
   failure values by running one search to completion under BrandVault's tenant
   (Unit A's first smoke).
2. Facade-polls-upstream vs facade-blocks — recommend facade owns polling; Unit
   A confirms against timeout behaviour.
3. `weighting` — captured empty; establish whether BrandVault ever sets it or
   always defaults.
4. Result cap / large result sets — the registry facade caps at 2000; confirm
   whether Smart Search results need the same refuse-with-count discipline.
5. De-dupe / watch semantics — for a saved watch (recurring search on a mark),
   how are new-since-last-run hits identified. v1 may be one-shot only; watch
   recurrence is v1.x.

## 7. AiLA Core integration (Unit C)

A completed Smart Search that is a *watch* (recurring, tied to a mark) emits
`watch.notice` into AiLA Core per the Core contract §3:
payload `{ mark ref, notice summary (e.g. "3 very-high hits for BLOC"),
deep_link into BrandVault's results view }`. A one-shot clearance search does
not emit; it is a synchronous user action with its result shown inline. Unit A
or B owns the emit hook; it is a single POST to Core's `/v1/events`.

## 8. Sequencing

1. Mark creates the BrandVault LawPanel tenant → hands Unit A the subscription
   key, `search_origin_id`, and the `/v1/registries` response.
2. Unit A (facade capability) and Unit B (BrandVault client against the §3 mock)
   build in parallel, separate sessions.
3. Unit A deploys → hands Mark the facade URL + BrandVault key → Mark sets
   BrandVault's env → Unit B swaps mock for live.
4. First live smoke settles the §6 open questions.
5. Unit C (watch.notice emit) when Core exists.
