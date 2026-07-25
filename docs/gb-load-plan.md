# GB load plan — real ASOS registry data over the fabricated seed

**Status: APPROVED AND EXECUTED 2026-07-24.** See §11 for the post-load record.
The plan below is unchanged from what was approved; every number in it was read
from the live Azure database and the export file before the load ran.

- Branch: `demo/real-gb-data`
- Export: `~/lawpanel/scratch/exports/asos-gb-20260724.json` (204 marks, 9.4 MB)
- Target company: `asos-plc` (`cmr6ir8cn0000p5m8r05a6i2d`)
- Transform: `scripts/load-gb-export.ts` (report-only; no write path exists yet)

---

## 1. Source and its limits

| | |
|---|---|
| Source | live BaseX GB, data VM 51.143.181.1 — Pass 2 rebuild, swapped 2026-07-15, pre-catch-up |
| GB corpus | 3,438,315 documents |
| Query | `gb:SearchByApplicantRepresentative('ASOS')` — `ft:search` over the `GB-mark-owner` and `GB-mark-representative` companion indexes |
| Transformation | none; values verbatim from registry XML including status vocabulary |

Two caveats carried from the export header, both of which affect what the demo
can honestly claim:

**Live marks only.** The owner/representative companion indexes are built over
`gb:IsLive` marks. Dead, Removed, Expired and Surrendered marks are *not
reachable by this search path*. The loaded portfolio will therefore contain no
dead marks at all. Anything in the demo that speaks to lapses, expiries or
"what changed" has no data behind it for GB.

**UK009 coverage.** The export header is explicit that the ~72% figure is
corpus-wide and **not** a measurement of this export: "UK009 completeness for
the marks in this file has not been measured and should not be inferred from
this figure." 31 UK009 marks are in scope here; whether that is all of ASOS's
comparable marks is unknown. Do not state a coverage percentage for this
portfolio on the recording.

---

## 2. Load scope — 173 of 204

The search matched on owner **and** representative, so the file contains marks
that are not ASOS's portfolio. Filter is on applicant name.

| Applicant | Marks | Loaded | Why |
|---|---|---|---|
| `ASOS plc` | 102 | ✅ | in scope |
| `ASOS HOLDINGS LIMITED` | 71 | ✅ | in scope |
| `EIGHT PAW PROJECTS LIMITED` | 22 | ❌ | ASOS is representative only, not owner |
| `Shenzhen asos E-Commerce Ltd.` | 6 | ❌ | unrelated third party, same name |
| `Crooked Tongues Limited` | 2 | ❌ | representative only |
| `Covetique Ltd` | 1 | ❌ | representative only |

**173 loaded, 31 left in the file untouched.** No mark has more than one
applicant, and no in-scope mark has a non-ASOS co-applicant, so the filter is
unambiguous. Application numbers are unique across the 173 — no dedup needed.

By series: **UK000 138 · UK009 31 · UK008 4**.

---

## 3. Status mapping

Source vocabulary is exactly four values. Verified against
`TradeMark/IPOPublicMarkCurrentStatusCode`, which agrees on all 173 marks —
there is no second, conflicting status field.

| Registry status (verbatim) | → `MarkStatus` | Marks | Reasoning |
|---|---|---:|---|
| `Registered` | `Registered` | 165 | Direct. |
| `Withdrawn` | `Abandoned` | 6 | The applicant stopped pursuing it; `Abandoned` is the only enum value carrying that meaning. Never registered, so no renewal obligation is being hidden. All 6 lack registration and expiry dates. |
| `Application Published` | `Published` | 1 | Direct. Live application in the opposition window — stays visible. |
| `Examination` | `Pending` | 1 | Live application under examination — stays visible. |

- **Total** — all four values have explicit entries. An unrecognised value makes
  the loader exit non-zero rather than defaulting.
- **Conservative** — both live-but-unregistered states map to live enum values,
  so nothing that still carries an obligation is mapped to a dead state.
- **Lossless** — the verbatim string goes to `registry_status_raw` on every row,
  so the mapping is auditable and reversible without re-importing.

---

## 4. Precondition: the pending migration

`prisma/migrations-pending/20260724_trademark_registry_status_raw/` must be
applied **before** the load, and the `schema.prisma` model patch applied in the
same window (see that directory's README — Prisma selects every scalar column,
so the model and the database must not be out of step across a deploy).

Without it there is nowhere to put the verbatim status and the mapping stops
being lossless.

---

## 5. Record counts — in and out

Current state, read live. `asos-plc` holds **81 marks: 32 UKIPO + 49 other
registries**. (My earlier figure of 33 counted across all companies — the 33rd
UKIPO row is `CONTOSO` / `UK5000001`, owned by `contoso-ltd`. It is out of scope
and is not touched.)

| Table | Now (on the 32) | Deleted | Inserted | After | Treatment |
|---|---:|---:|---:|---:|---|
| `trademarks` (UKIPO, asos-plc) | 32 | 32 | 173 | 173 | replaced |
| `trademarks` (all, asos-plc) | 81 | 32 | 173 | **222** | |
| `goods_and_services` | 45 | 45 | 999 | 999 | operational — travels |
| `deadlines` | 49 | 49 | 306 *(see §7)* | 306 | operational — travels |
| `notes` | **0** | – | – | 0 | nothing to decide |
| `notifications` | **0** | – | – | 0 | operational — none exist |
| `notification_reads` | 0 | – | – | 0 | – |
| `approvals` | **0** | 0 | – | 0 | history — preserved |
| `inbound_emails` | **0** | 0 | – | 0 | history — preserved |
| `bree_query_logs` | **1** | 0 | – | 1 | history — preserved, FK nulled |
| `audit_logs` (company-wide) | 2 | 0 | – | 2 | history — untouched |

Company-wide totals after: `deadlines` 76 + 306 = **382**; `goods_and_services`
83 + 999 = **1,082**.

**Notes: there are none.** No note row exists on any of the 32 marks, or
anywhere for this company. Nothing to preserve, nothing to judge.

---

## 6. Child-table treatment — and why no history is at risk

Reading the FK definitions settles the concern about cascading through history:

| Table | FK to `Trademark` | On delete | Consequence |
|---|---|---|---|
| `audit_logs` | **none** — uses `entityType`/`entityId` strings | n/a | completely unaffected |
| `approvals` | `trademarkId String?` | `SetNull` | row survives, pointer clears |
| `inbound_emails` | `matchedTrademarkId String?` | `SetNull` | row survives, pointer clears |
| `bree_query_logs` | `matchedTrademarkId String?` | `SetNull` | row survives, pointer clears |
| `notifications` | `trademarkId String?` | `SetNull` | row survives, pointer clears |
| `deadlines` | `trademarkId String` (required) | `Cascade` | dies with its mark |
| `goods_and_services` | `trademarkId String` (required) | `Cascade` | dies with its mark |
| `notes` | `trademarkId String` (required) | `Cascade` | dies with its mark |

**No history-bearing row FK-requires its parent mark to exist.** Every one of
them either has no FK at all or a nullable one that `SetNull`s. So the "keep a
retired fabricated mark / null the FK / re-point" trade-off does not arise as a
structural problem — deleting the 32 preserves all history automatically.

What *is* at stake is not row survival but **legibility**: a history row that
loses its mark pointer no longer says which mark it was about.

---

## 7. The two surviving 2026-07-14 artifacts

Only two rows in the whole database reference the fabricated marks, and both
point at the **same** mark — `asos-0001-8777-3077` = `UK0001000` / "ASOS".
These are the residue of the live verification; the approval and inbound-email
rows from that session were purged at the time, as recorded in `CLAUDE.md`.

| Row | Points via | Created | Content |
|---|---|---|---|
| `audit_logs` `cmrky30wd0001jv04cqajuz48` | `entityId` (plain string, no FK) | 2026-07-14 17:48 | `bree.email.renewal_completed` |
| `bree_query_logs` `cmrkkeu600003ju040e7gjnq3` | `matchedTrademarkId` (nullable FK) | 2026-07-14 11:25 | Bree query matched to that mark |

**Recommendation, per case:**

**Audit row — leave completely untouched.** It has no FK, so the delete does not
touch it. Its `entityId` becomes a dangling reference to a row that no longer
exists. I recommend accepting that rather than rewriting it: the audit log is an
append-only record of what happened, and editing `entityId` to point at a
different mark would make it assert something that never occurred. The mapping
`asos-0001-8777-3077 = UK0001000 "ASOS" (fabricated, deleted 2026-07-__)` is
recorded in this document, which is where that context belongs.

**Bree query log — let the FK null.** Same reasoning. The row keeps its
timestamp and query text; only the mark pointer clears.

**Why not re-point either to a real mark:** the export contains **16 real ASOS
word marks** (`UK00002530115`, `UK00003093871`, … `UK00917011552`). There is no
principled way to choose which one the 2026-07-14 event "really" concerned,
because the event concerned a fabricated mark. Picking one would manufacture a
linkage that never existed, in the audit trail specifically — the one place
where that is least acceptable.

**Why not keep `UK0001000` as a retired mark:** it would leave a fabricated
"ASOS" mark sitting in the portfolio next to 16 real ones during the demo
recording. If you would rather preserve linkage at that cost, it is a one-line
change to the delete set — say so and I will make it, but I would not.

---

## 8. Decisions I need from you

1. **Device marks with no verbal element (7 marks).** `markText` is `NOT NULL`,
   but these are pure figurative marks — `UK00002182599`, `UK00003757828`,
   `UK00003819949`, `UK00003834437`, `UK00003843033`, `UK00906273701`,
   `UK00909134181` — carrying only a `MarkImageUri`. This is the nature of the
   mark, not incomplete data, so `needsData` stays false.
   **Proposed:** store the literal `[device mark, no verbal element]`.
   Alternatives: use the application number as the display text, or skip the 7
   (loading 166). I recommend the placeholder — it is honest in the UI and keeps
   the portfolio complete.

2. **Renewal deadlines on withdrawn marks.** The engine derives UKIPO renewals
   from the **filing** date (`termFrom: filing`), and nothing anywhere gates
   deadline generation on mark status. So the 6 `Withdrawn` marks would each get
   renewal deadlines — **12 spurious rows** asserting live obligations on dead
   applications. This is pre-existing behaviour that the fabricated data never
   exposed, because it contained no dead marks.
   **Proposed:** the loader skips deadline generation for marks mapped to
   `Abandoned` or `Expired` → **294 deadlines instead of 306**. This is a
   loader-side gate; I am *not* proposing to modify the obligation engine, which
   `CLAUDE.md` marks as preserved code. The 2 deadlines on `Application
   Published` and 1 on `Examination` are correct and stay — those are live
   applications whose UK renewal genuinely runs from filing.

3. **Families.** `asos-plc` currently has **zero** `TrademarkFamily` rows and no
   mark references one. Per the data-model rule, families are explicit entities
   and are never inferred from `mark_text`, so the load creates none and every
   mark lands with `familyId = null`. Confirm that is what you want for the
   demo, or treat family creation as separate work.

4. **`clientAgentName`.** The fabricated rows carry "ASOS PLC Legal Department".
   The register has no equivalent field, so it will be `null` on all 173.
   `representativeName` is populated on 153 (Barker Brettell LLP 44, ASOS PLC
   108, Rheia IP Limited 1). Flagging in case anything in the demo reads
   `clientAgentName`.

---

## 9. Two transform decisions already taken

Recorded here because they change stored values, and both are visible in
`scripts/load-gb-export.ts`.

**Calendar dates, not instants.** GB dates arrive in three forms, including
`1969-07-15T00:00:00.000+01:00`. Parsed naively that becomes `1969-07-14` in
UTC — the date moves back a day. **96 of the 173 marks carry at least one such
date.** The loader takes the leading `YYYY-MM-DD` and pins it to UTC midnight,
preserving the date as the register states it.

**No registration number.** GB register data has no `RegistrationNumber` field —
the application number carries through on registration. `registrationNumber` is
left `null` rather than duplicating `applicationNumber`.

---

## 10. Proposed execution order

Not run. For approval as a sequence.

1. Snapshot the 32 marks and their children to a JSON file outside the DB
   (rollback material).
2. Apply the `registry_status_raw` migration + the `schema.prisma` patch;
   `prisma generate`.
3. In one transaction: delete the 32 UKIPO marks for `asos-plc`
   (cascades 49 deadlines + 45 goods/services; nulls 1 `bree_query_logs` FK).
4. Insert 173 marks + 999 goods/services.
5. Run the deadline engine over the 173 with the status gate from decision 2.
6. Verify: 222 marks, 999 goods/services, 294 deadlines, 2 audit rows intact,
   1 bree query log intact with a null mark pointer.

**Rollback:** restore from the step-1 snapshot; `DROP COLUMN
registry_status_raw`. The deleted rows are fabricated seed data with no external
references beyond the two artifacts in §7, so the blast radius is contained.

**Note on the shared database:** Preview and Production point at the same Azure
instance. This load changes what production serves. There is no separate preview
copy to rehearse against.

---

## 11. Execution record — 2026-07-24

Approved with all four decisions and the timezone handling. Executed against the
shared Azure database (`brandvault-mysql…/brandvault`).

**Predictions vs actual — all matched, nothing off-prediction:**

| Check | Predicted | Actual |
|---|---:|---:|
| `trademarks` (asos-plc, total) | 222 | **222** ✓ |
| `trademarks` (UKIPO) | 173 | **173** ✓ |
| `goods_and_services` | 999 | **999** ✓ |
| `deadlines` | 294 | **294** ✓ |
| `audit_logs` preserved | 2 | **2** ✓ |
| `bree_query_logs` preserved | 1 (of 7) | **7** ✓ |

**Steps run, in order:**

1. Snapshot → `~/lawpanel/scratch/exports/brandvault-ukipo-snapshot-20260724.json`
   (32 marks, 45 goods/services, 49 deadlines, 0 notes, plus the referencing
   history rows). This is the rollback material.
2. DDL applied (`prisma db execute`), `schema.prisma` patched and
   `prisma generate` run in the same step — not separated by a deploy.
3. One transaction: deleted 32 UKIPO marks (cascading 49 deadlines + 45
   goods/services, nulling 1 `bree_query_logs` FK), inserted 173 marks, 999
   goods/services, 294 deadlines.
4. Migration promoted from `migrations-pending/` to `prisma/migrations/` as
   `20260724120000_trademark_registry_status_raw` and marked applied via
   `prisma migrate resolve`. Without this, Prisma's history would not have known
   the column existed and `migrate dev` would have reported drift and offered to
   reset — a real hazard on a shared production database.

**Verified after the load:**

- Status mapping and passthrough: `Registered←Registered` 165,
  `Abandoned←Withdrawn` 6, `Pending←Examination` 1,
  `Published←Application Published` 1.
- Deadline gate holds: Registered 291, Published 2, Pending 1, **Abandoned 0**.
- 7 device marks stored as `[device mark, no verbal element] UK000…`,
  `needsData = false`.
- Calendar dates preserved: `UK00000945589` ("Miss Selfridge") filed
  **1969-07-15**, not 1969-07-14.
- History intact: both audit rows present; the `bree.email.renewal_completed`
  row still carries `entityId = asos-0001-8777-3077`, now dangling **by design**
  (see §7). The Bree query log survives with a null mark pointer.
- Untouched as intended: 49 non-UKIPO marks (EUIPO 24, USPTO 13, WIPO 4,
  IP Australia 4, IPOS 2, INPI 1, CIPO 1) and Contoso's `UK5000001`.
- `familyId` null on all 173; `clientAgentName` null on all 173; 31 UK009 marks.

**Recorded for the dangling audit reference:**
`asos-0001-8777-3077` = `UK0001000` "ASOS" — fabricated seed mark, deleted
2026-07-24. This is the mark the 2026-07-14 renewal-completion audit entry
refers to.

**Engine issue logged** in `CLAUDE.md` under Outstanding / deferred: the
obligation engine does not gate on mark status. The loader-side gate protects
imported marks only, not marks edited to a dead status in the app.
