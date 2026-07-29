# Registry read facade — API contract & hosting proposal (v1, FREEZES AT REVIEW)

For: BrandVault portfolio-import feature. Consumer: BrandVault backend only (server-side).
Source of truth for scope: `docs/portfolio-import-handoff.md`. Settled decisions folded in:
Azure Function hosting; `registry` as a path parameter (only `gb` implemented in v1);
refuse-with-count over pagination; admin entry ships first.

Status when written: live `GB` = 3,438,315 docs, corpus **as at 2026-07-11** (Pass-2; the
Pass-3 catch-up is staged at the Phase-4 gate, not swapped). This contract is stable across
that swap — only the `currencyDate` value and the UK009 caveat change, and both are sourced
at runtime, never hardcoded in BrandVault.

---

## PART A — API CONTRACT

### A0. Conventions

- **Base path:** `/registry/{registry}/…`. `registry` is a lowercase ISO-ish registry code.
  v1 implements `gb` only. Any other value → `501 REGISTRY_NOT_IMPLEMENTED` (see A6). This
  keeps multi-registry URLs stable from day one without implying data exists.
- **Transport:** HTTPS only. JSON request and response (`Content-Type: application/json`).
- **Read-only:** every endpoint is a read against BaseX. The facade never writes to any
  registry database. All queries are **index-backed or single-document by name** — no
  full-corpus scans (see A7 on the shared-lane guard).
- **Every response payload carries these envelope fields**, success or refusal:
  - `registry` — echoes the path param, e.g. `"gb"`.
  - `currencyDate` — the corpus "as at" date, ISO `YYYY-MM-DD`. **Sourced from the
    registry side, never assumed by BrandVault.** v1: the Function reads a single
    registry-controlled value (`GB_CORPUS_AS_AT`, updated by the registry team at each
    swap); target: a `GB-meta` currency document read at query time (see A8). Today it is
    `"2026-07-11"`.
  - `coverage` — object of known-partiality caveats, machine-readable so product copy is
    driven by data not by a hardcoded string. v1 shape:
    `{ "uk009": { "partial": true, "approxPct": 72, "note": "UK009 (Brexit comparable) coverage is corpus-wide ~72% pending the UKIPO baseline ingest; absence of a UK009 mark is not proof of non-existence." } }`.
    When the UK009 baseline ingest lands registry-side, the Function flips `partial:false`
    and BrandVault drops the caveat automatically.
  - `apiVersion` — `"1"`.

### A1. Auth

- Single shared secret, header `X-BrandVault-Key`, validated in the Function. Server-side
  only — never shipped to the browser. Missing/invalid → `401` (A6).
- The Azure Function's own `x-functions-key` is a second, independent gate (defence in
  depth); BrandVault holds both as Vercel server-side env vars. See Part B for why both.

### A2. `POST /registry/{registry}/search-by-owner`

Owner/proprietor search. Backs the checkbox step. Cheap (index-only), never refuses on size.

**Request**
```json
{ "query": "ASOS" }
```
- `query` (string, required, 2–120 chars). Full-text token match against the owner and
  representative companion indexes (`GB-mark-owner`, `GB-mark-representative`). Tokenised:
  `"ASOS"` also matches `"Shenzhen asos E-Commerce Ltd."` — this is intended and surfaced,
  not filtered (the user disambiguates via checkboxes).

**Response 200**
```json
{
  "registry": "gb",
  "apiVersion": "1",
  "currencyDate": "2026-07-11",
  "coverage": { "uk009": { "partial": true, "approxPct": 72, "note": "…" } },
  "query": "ASOS",
  "cap": 2000,
  "owners": [
    { "ownerString": "ASOS plc",                      "matchedVia": ["owner"],          "markCount": 102 },
    { "ownerString": "ASOS HOLDINGS LIMITED",         "matchedVia": ["owner"],          "markCount": 71 },
    { "ownerString": "Shenzhen asos E-Commerce Ltd.", "matchedVia": ["owner"],          "markCount": 6 },
    { "ownerString": "ASOS PLC",                      "matchedVia": ["representative"], "markCount": 133 }
  ],
  "totalDistinctMarks": 204
}
```
- `owners[]` — one row per distinct index string that matched. Sorted by `markCount` desc.
  - `ownerString` — the **exact** string to pass back to `/marks` (do not re-derive/trim).
  - `matchedVia` — array of `"owner"` and/or `"representative"`. **BrandVault must render
    owner vs representative distinctly, and default representative-only rows to unchecked**
    (handoff §3b.1). A string can match both (rare) → `["owner","representative"]`.
  - `markCount` — distinct live marks under that exact string (index count).
- `totalDistinctMarks` — distinct marks across all rows (union; a mark under two strings is
  counted once). This is the number the cap is checked against at `/marks`.
- `cap` — echoes the server cap so the UI can pre-warn before the user hits `/marks`.

Note on the numbers above: they are the live-GB ASOS figures behind
`~/lawpanel/scratch/exports/asos-gb-20260724.json` and are illustrative of the shape.

### A3. `POST /registry/{registry}/marks`

Full mark documents for the ticked owner strings. **Refuses over the cap** (no pagination).

**Request**
```json
{ "ownerStrings": ["ASOS plc", "ASOS HOLDINGS LIMITED"], "raw": false }
```
- `ownerStrings` (string[], required, 1–50 items). Must be **exact** strings returned by
  `/search-by-owner`. Unknown strings are ignored (reported in `unmatchedOwnerStrings`),
  not an error — but if none match, `marks` is `[]`.
- `raw` (bool, optional, default `false`). `false` = the structured mark shape (A5). `true`
  = additionally include `allLeafElements` (the complete verbatim element dump — large;
  only needed for audit/debugging, not for the loader).

**Response 200** — matches the export file shape (`export` envelope + `marks[]`):
```json
{
  "registry": "gb",
  "apiVersion": "1",
  "currencyDate": "2026-07-11",
  "coverage": { "uk009": { "partial": true, "approxPct": 72, "note": "…" } },
  "cap": 2000,
  "requestedOwnerStrings": ["ASOS plc", "ASOS HOLDINGS LIMITED"],
  "unmatchedOwnerStrings": [],
  "export": {
    "source": "live BaseX GB (Pass 2, as at 2026-07-11)",
    "currencyDate": "2026-07-11",
    "transformation": "none — verbatim registry XML; status vocabulary unmapped",
    "markCount": 173
  },
  "marks": [ /* A5 objects */ ]
}
```

**Response 413 (cap exceeded)** — refuse-with-count, the settled "contact us" behaviour:
```json
{
  "registry": "gb",
  "apiVersion": "1",
  "currencyDate": "2026-07-11",
  "error": { "code": "CAP_EXCEEDED", "message": "Result set exceeds the per-import cap." },
  "cap": 2000,
  "matchedDistinctMarks": 5177,
  "ownerBreakdown": [
    { "ownerString": "BIG CO PLC", "matchedVia": ["owner"], "markCount": 5177 }
  ]
}
```
BrandVault renders "contact us" and does not retry. The cap is checked against the **union
distinct count** of the requested strings, computed cheaply from the indexes before any
document is opened.

### A4. `GET /registry/{registry}/mark/{applicationNumber}`

One mark document by application number.

- `applicationNumber` — path segment, validated `^UK[0-9A-Z]{6,13}$` (covers `UK000…`,
  `UK008…`, `UK009…`, and the `UK0002527368A` suffixed forms). Invalid → `400`.
- **200** → `{ registry, apiVersion, currencyDate, coverage, mark: <A5 object> }`.
- **404** → `MARK_NOT_FOUND` if no `UK<appnum>.xml` in the corpus. Absence is **not** proof
  of non-existence for UK009 while `coverage.uk009.partial` is true — the 404 body repeats
  the caveat so BrandVault can word it honestly.
- **⚠ KNOWN DEPENDENCY (this endpoint):** the facade implements this via
  `db:open('GB', $applicationNumber || '.xml')` — a direct name lookup, which is **not**
  affected by the deployed `gb.xqm` bug. **Do NOT** implement it by delegating to the
  deployed BaseX `possibletrademarks` / `trademark-details` path: that path runs
  `gb:GetPossibleTrademarks → gb:SearchByText`, whose line-23 index name is the one-char
  typo `GBmark-text` (should be `GB-mark-text`), so it returns HTTP 500 for GB today. The
  fix is a **separate gated change, AFTER the Pass-3 swap settles** — do not edit
  `/data/basex/webapp/gb.xqm` as part of this build. Consequence for v1: any future
  **search-by-mark-text** endpoint is blocked until that fix lands; the three v1 endpoints
  here are not, because they route through the owner index, the application-number index,
  and name lookup only.

### A5. Mark object schema (matches the export shape)

Field names and nesting mirror `asos-gb-20260724.json` so `scripts/load-gb-export.ts`
consumes facade output unchanged. Verbatim registry values; **no** status mapping done
facade-side (BrandVault maps + keeps `registry_status_raw`).

```json
{
  "application_number": "UK00003648574",
  "doc_name": "UK00003648574.xml",
  "series_prefix": "UK000",
  "matched_via": ["owner"],
  "matched_owner_strings": ["ASOS plc"],
  "status": "Registered",
  "mark_text": ["ASOS ACTUAL"],
  "kind_mark": "Word",
  "mark_feature": "Word",
  "dates": [ { "path": "TradeMark/ApplicationDateTime", "value": "2021-05-28T00:00:00.000+01:00" } ],
  "applicants":      [ [ { "field": "Applicant/Name", "value": "ASOS plc" } ] ],
  "representatives": [ [ { "field": "Representative/Name", "value": "ASOS PLC" } ] ],
  "goods_services": [
    { "class_number": "9", "description": "Downloadable application software; …",
      "language_code": "en", "use_nice_heading_indicator": "false" }
  ]
  /* "allLeafElements": [...]  ← present only when request `raw:true` */
}
```
Deliberate differences from the raw export file, called out so the loader author isn't
surprised:
- **`node_id` is dropped.** It is a BaseX internal that renumbers on every `db:optimize`
  (the swap does exactly that) — unstable, never a key. `application_number` is the key;
  `doc_name` is the stable file identity.
- Device marks: `mark_text` is `[]` (empty array), never invented. BrandVault applies the
  `"[device mark, no verbal element] <appnum>"` display convention (handoff §3b) — the
  facade does not, so nothing is transformed. Image display is a separate CDN-hotlink
  concern (see A9), not part of this JSON.
- `status` is the verbatim registry string (`Registered`, `Withdrawn`, `Examination`,
  `Application Published`, and — in future imports — `Dead`/`Removed`/`Opposed`). The
  loader's **abort-on-unmapped-status** gate stays; the facade never maps.

### A6. Error codes

| HTTP | `error.code`                | When |
|------|-----------------------------|------|
| 400  | `BAD_REQUEST`               | malformed body, missing `query`/`ownerStrings`, bad `applicationNumber` format |
| 401  | `UNAUTHORIZED`              | missing/invalid `X-BrandVault-Key` (or Function key) |
| 404  | `MARK_NOT_FOUND`            | `/mark/{appnum}` not in corpus (see UK009 caveat) |
| 413  | `CAP_EXCEEDED`              | `/marks` union distinct count > `cap` — refuse-with-count |
| 501  | `REGISTRY_NOT_IMPLEMENTED`  | `registry` path param ≠ `gb` |
| 502  | `UPSTREAM_UNREACHABLE`      | BaseX unreachable (NSG/egress-IP/VM down — see B1 note) |
| 503  | `UPSTREAM_BUSY`             | facade self-throttle: a swap window is flagged, or BaseX returned a lock-blocked/timeout |
| 504  | `UPSTREAM_TIMEOUT`          | BaseX query exceeded the facade's per-request budget |
| 500  | `INTERNAL`                  | anything else |

Error body shape (all): `{ registry, apiVersion, currencyDate?, error: { code, message } }`.

### A7. Cap & shared-lane discipline

- `cap` default **2000** (config `RESULT_CAP`). Applies to `/marks` only; `/search-by-owner`
  and `/mark/{appnum}` are inherently bounded and never refuse.
- Cap is evaluated from **index counts before opening any document** — the refusal costs no
  document reads.
- The facade sets a BaseX **query timeout** on every call (config `QUERY_TIMEOUT_MS`,
  default 20000) so a facade request can never become the 27-hour zombie the runbook warns
  about. A timeout surfaces as `504`.
- **Swap-window interlock:** the facade reads a `PAUSE_HEAVY` flag (config / health endpoint);
  while a Phase-5 swap or optimize is in progress the registry team sets it and the facade
  returns `503 UPSTREAM_BUSY` rather than competing on the single BaseX lane. `/marks` for a
  full portfolio (≤ cap) is index + targeted `db:open` — light — but the interlock exists so
  nothing runs against BaseX during a swap by policy, not just by good behaviour.

### A8. `GET /registry/{registry}/health` (ops, unauthenticated-safe)

`{ registry, apiVersion, currencyDate, coverage, baseXReachable: true, pauseHeavy: false }`.
No mark data. Lets BrandVault (and monitoring) read the current `currencyDate`/coverage for
copy without a data query, and confirms reachability independent of the NSG/egress issue in
B1.

### A9. Out of scope for this JSON (documented so it isn't assumed)

- **Images:** device-mark images are not in this payload. They serve as a CDN hotlink,
  `https://lawpanel-data.azureedge.net/images/GB/{filename}`, where `{filename}` is the last
  path segment of the corpus `MarkImageUri` (**not** always `{appnum}.jpg` — e.g.
  `UK00002182599_1_0.jpg`). If BrandVault renders images, add a facade field later that
  returns the computed URL per mark; for v1 the loader can compute it from
  `allLeafElements` under `raw:true`.
- **Non-UK registries:** not implemented; `501`. Marks in other jurisdictions are
  user-maintained in BrandVault, labelled provenance per mark (handoff §3d).
- **Dead/expired marks:** the owner index returns live marks only — imported portfolios have
  no lapsed-mark history, and copy must not imply otherwise.

---

## PART B — NETWORK / HOSTING PROPOSAL

Three links to secure: BrandVault(Vercel) → Function → BaseX(data VM). Priorities: keep
BaseX private and read-only, keep the shared lane protected, minimal always-on cost while
volume is admin-entry-only.

### B1. Function → BaseX reach (NSG / VNet)

Constraint: `data-nsg` restricts port **8984** to an allowlist (worker `51.140.94.6`,
Mark's admin IP `82.3.161.235`, and the App Service outbound pool). BaseX listens on the
VM's public IP `51.143.181.1:8984` with factory `admin:admin` (rotation is registry TODO#10).
A residential/VPN **egress-IP rotation silently breaks 8984 access** — observed this session
(`rc=28` timeouts while BaseX was healthy). The facade must reach BaseX from a **stable,
allowlisted source**, and ideally over a private path so the public 8984 exposure can close.

Options, cheapest-first:

1. **Consumption Function + NAT Gateway (static egress IP) → add IP to `data-nsg`.**
   Cheapest compute; NAT Gateway gives one stable outbound IP to allowlist. Cold-start on
   the Consumption plan (BaseX calls are sub-second, but first invoke adds ~1–3 s).
   ~£25–35/mo (NAT Gateway + minimal Function). BaseX still reached over public IP.
   *Downside:* still public 8984; still `admin:admin` over the wire (mitigate: dedicated
   read-only BaseX user — a registry-side change, not this build).

2. **Premium Function (EP1) with VNet integration → peer/join the data-VM VNet → reach
   8984 on the VM's private IP; `data-nsg` allows the integration subnet.** No cold start,
   stable private egress, lets the public 8984 rule eventually be removed. ~£110–150/mo.
   Requires the data VM's subnet to be reachable (peering or same VNet) — a small
   registry-side network change. **Recommended target** once launch volume justifies
   always-on.

3. **Small always-on Linux container/App Service co-located near the VM.** Similar cost to
   (2), no Functions programming model benefit; only prefer if the team wants a plain
   service. Not recommended over (2).

**Recommendation:** ship v1 on **(1) Consumption + NAT Gateway static IP** (fast, cheap,
admin-entry volume), with **(2)** as the documented upgrade path when self-serve opens —
the migration is a hosting-plan + VNet change behind the same contract, invisible to
BrandVault. Independently of choice, add a dedicated **read-only BaseX user** and set
`QUERY_TIMEOUT` (registry-side; both are pre-existing TODOs this feature makes concrete).

### B2. Vercel → Function auth

BrandVault's backend (Next API routes / server actions) is the only caller — **never the
browser**.

- **Primary:** shared secret header `X-BrandVault-Key`, validated in-Function, over HTTPS.
  This is the spec's "single API key for BrandVault, server-side only."
- **Plus:** Azure Functions built-in `x-functions-key`. Two independent secrets so rotating
  one (or a leak of one) doesn't open the door. Both live as Vercel **encrypted env vars**,
  referenced only server-side.
- Vercel egress IPs are dynamic on standard plans, so we do **not** IP-allowlist the
  Function to Vercel; the shared secret + HTTPS + server-side-only usage is the boundary.
  If stronger origin binding is wanted later: Vercel Enterprise static egress IPs, or front
  with Azure AD client-credentials (heavier — defer).
- No CORS is enabled on the Function (no browser origin ever calls it).

### B3. The dormant APIM instance — priced option

There is an existing API Management instance: **`lawpanel`** (rg `infrastructure-rg`,
North Europe), currently fronting the Firms API.

- **SKU today: Developer, capacity 1, no VNet** (`virtualNetworkType: None`), single public
  IP `4.207.97.205`, custom domains `api.lawpanel.com` / `developer.lawpanel.com`.
- **Cost:** Developer tier ≈ **£40/mo**, but it carries **no SLA** and is explicitly not for
  production traffic. Its custom-domain TLS cert is **expired** (`*.lawpanel.com`, expired
  2024-11-07) — using the custom domain would require a cert renewal first.

What APIM would buy us if we front the facade Function with it:
- Subscription-key auth + per-key **rate-limit and quota** policies — a managed way to
  protect the shared BaseX lane (complements, doesn't replace, the A7 cap).
- Managed gateway, request logging, a developer portal.

Assessment: **not recommended for v1.** To use it in production we'd need to move it off
Developer tier (Basic ≈ £120/mo / Standard ≈ £500/mo for an SLA), renew the cert, and
VNet-integrate it to reach a private BaseX — more moving parts and cost than a Consumption
Function + NAT Gateway, for a single server-side consumer. Keep APIM as the **scale-out
option**: revisit when there are multiple external consumers or a public developer offering,
at which point its auth/quota/portal machinery pays for itself. Priced here so the choice is
explicit, not defaulted.

### B4. Summary recommendation

| Link | v1 (ship now) | Upgrade path |
|------|---------------|--------------|
| Function → BaseX | Consumption Function + NAT Gateway static IP on `data-nsg`; read-only BaseX user; query timeout | Premium EP1 + VNet integration → private 8984, close public rule |
| Vercel → Function | `X-BrandVault-Key` + `x-functions-key`, HTTPS, server-side only | Azure AD client-creds / Vercel static egress if origin-binding needed |
| Gateway/quota | facade-internal cap (A7) | APIM (raise off Developer tier + renew cert) when multi-consumer |

Rough v1 run cost: **~£25–35/mo** (NAT Gateway dominates; Consumption compute negligible at
admin-entry volume).

---

## Launch dependencies (copy, not build — confirm with registry project before public launch)

1. **Catch-up swap** — staged at the Phase-4 gate today (`GB-rebuild2` = 3,455,667, not
   promoted; live still 3,438,315 as at 2026-07-11). On swap, `currencyDate` moves to
   current and the daily WebJob keeps it so. The facade surfaces this automatically.
2. **UK009 baseline ingest** — `rep_export_2026_03` extract downloaded (38/38), **not
   ingested**. On ingest, `coverage.uk009.partial` flips false and the 72% caveat drops.
3. **`gb.xqm` `GBmark-text` one-char fix** — gated, AFTER the Pass-3 swap settles. Blocks
   only a future search-by-mark-text endpoint; the three v1 endpoints route around it. The
   `/mark/{appnum}` endpoint must use `db:open` by name, not the deployed details path (A4).
