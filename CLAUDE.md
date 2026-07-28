# BrandVault

Trademark portfolio management SaaS. Part of the AiLA product suite.

## What this is

Next.js 14 frontend currently serving a static JSON snapshot of 81 ASOS marks
across 8 registries. Being evolved into a full product with backend, auth,
Slack integration, and multi-tenant data.

## Stack

- **Frontend:** Next.js 14 / React 18 / TypeScript on Vercel
- **Auth:** Clerk (company-as-customer, roles: admin / editor / viewer + platform admin)
- **Backend:** Next.js API routes + Prisma ORM + Azure Database for MySQL
- **Slack:** Bree (the BrandVault Slack assistant)
- **Email:** SMTP via Azure (secondary alert channel)

## Environment variables (Vercel)

Set per scope in Vercel → Settings → Environment Variables. **Build** vars must
exist at build time or `next build` fails during prerender; **runtime** vars are
read when the function executes. `.env.example` documents all of them.

| Variable | Purpose | Needed at | Prod | Preview | Local | Notes |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | Prisma → Azure MySQL | runtime | ✅ | ✅ | ✅ | Separate values per scope, but Preview & Production point at the **SAME Azure DB** (`brandvault-mysql…/brandvault`). **KNOWN DECISION — accepted for MEV (2026-07-14); SEPARATE THE PREVIEW DB BEFORE THE FIRST EXTERNAL CUSTOMER.** Until then, preview testing writes to prod data — purge test rows before demos. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk (browser) | **build**+runtime | ✅ | ✅ | ✅ | Missing at build → prerender fails (`Missing publishableKey`). |
| `CLERK_SECRET_KEY` | Clerk (server/middleware) | runtime | ✅ | ✅ | ✅ | Missing → 500 `MIDDLEWARE_INVOCATION_FAILED`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `_SIGN_UP_URL` | Clerk routing | build+runtime | ✅ | ✅ | ✅ | `/sign-in`, `/sign-up`. |
| `ANTHROPIC_API_KEY` | email + Bree-intent classifiers | runtime | ✅ | ✅ | ✅ (`.env`) | Sensitive. **Confirmed added by operator 2026-07-14** (brandvault-asos project only; Prod + Preview). Did NOT exist in any Vercel scope before then — so the deployed email classifier had never run live. Absent → email classifier throws (email stays `pending`); intent → graceful `unsupported`. Read ONLY from env (SDK default `new Anthropic()`), no other source. |
| `EMAIL_CLASSIFIER_MODEL` | model override | runtime | opt | opt | opt | default `claude-sonnet-4-6`. |
| `AUTO_ACT_REGISTRATION` | promote registration_certificate back to auto-act | runtime | opt | opt | opt | **Unset/`false` = propose-and-approve (default).** `true` = a HIGH-confidence registration certificate writes `status→Registered` directly (pre-revision behaviour). `renewal_confirmation` is **never** auto — no flag promotes it. |
| `BREE_INTENT_MODEL` | model override | runtime | opt | opt | opt | default `claude-haiku-4-5`. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` | Bree OAuth + slash-signature verify | runtime | ✅ | opt | ✅ | Slash/OAuth work where set. |
| `NEXT_PUBLIC_APP_URL` | deep-link + Bree icon base URL | build+runtime | opt | opt | opt | default `https://brandvault-asos.vercel.app`. |
| `POSTMARK_INBOUND_SECRET` | inbound webhook auth | runtime | ✅ | opt | ✅ | Route returns 503 without it. |
| `INBOUND_FALLBACK_COMPANY_SLUG` | testing: hash addr → company | runtime | `asos-plc` | opt | opt | routes the Postmark hash address to a company. |
| `CRON_SECRET` | cron + `/api/email/process` guard | runtime | ✅ | opt | – | Guards those endpoints (Bearer). |
| `SEED_CLERK_ORG_ID` | link seed data to a Clerk org | seed | – | – | opt | local seed only. |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | email alert channel | runtime | – | – | – | **Not wired** — email deferred; the alert job counts + skips email gracefully. |

## Hosting region

Serverless functions are pinned to **`fra1`** (Frankfurt) in `vercel.json`,
the nearest Vercel region to the Azure West Europe database.

Nothing pinned a region until 2026-07-28: no `regions` key, no
`preferredRegion` on any route, so functions ran in the project default (a US
region) while the database sat in Europe. Every Prisma query crossed the
Atlantic twice, plus a strict-TLS handshake per cold instance. The HAR that
exposed it is the clearest statement of the problem: `/api/me` spent **2335ms
returning 240 bytes**. No amount of query tuning explains 240 bytes, and every
`clerk.getbrandvault.com` request in the same capture was 53-333ms, so the cost
was not Clerk and not query volume. It was distance.

Two things follow. Keep the region and the database in the same part of the
world: moving either without the other reintroduces this. And **`vercel.json`
is schema-validated, so it takes no comments** — a `"//"` key is valid JSON but
Vercel rejects it and the deploy fails. Rationale for anything in that file
belongs here instead.

## CSS rules

- Existing components use CSS Modules. Do not migrate them.
- All new components use Tailwind. Design tokens in tailwind.config.
- Never mix CSS Modules and Tailwind within a single component.

## Code to preserve

- `lib/utils.ts` — the obligation/deadline engine is production-quality.
  Jurisdiction-specific renewal rules for 7 registries. Do not rewrite
  unless explicitly asked.

## Data model rules

- Trademark families are explicit entities, not inferred from mark_text matching.
- Individual legal rights records are NEVER merged. Pre/post-Brexit conversion
  records, Madrid designations, and national registrations remain distinct
  even when they share a family.
- Minimum required fields for a mark: mark_text, registry_name, status.
  All other fields optional. Handle incomplete records gracefully —
  completeness prompts, not blocking errors.
- Deadline engine skips marks with missing dates and flags them as "needs data."

## Clerk role mapping

`mapRole` in `lib/tenant.ts` maps the Clerk org role to our `UserRole`:

| Clerk | BrandVault |
|---|---|
| `org:admin` | `admin` |
| `org:member` (and anything unrecognised) | `viewer` |

Members map to **viewer, not editor**. An ordinary member should not get write
access to a live portfolio by default; a reviewer account added as a member was
landing as an editor of 222 production marks (2026-07-28).

- **`editor` is currently unreachable through login.** Setting it by hand does
  not stick: `resolveUser` reconciles role on every authenticated request and
  restores the mapped value. Reaching editor again needs a Clerk role that maps
  to it, added to `mapRole` deliberately.
- **This mapping is deliberately provisional.** It suits a two-person workspace
  (one `org:admin`, one member). **The first real customer's role scheme
  supersedes it** — a customer with staff who genuinely need write access will
  need real Clerk roles mapped here, and that supersession is expected, not a
  regression.
- **Viewers are denied writes in the shared auth path, not per route.**
  `getRequestContext` refuses a viewer on `POST`/`PUT`/`PATCH`/`DELETE` with 403
  before resolving the target company, so **a route added later inherits the
  gate**. Enforcing per route is what let `POST`/`PATCH`/`DELETE`
  `/api/trademarks*`, bulk and notes ship with no role check at all.
  - Opting out is deliberate and visible: `getRequestContext(req, { allowViewer:
    true })`. Only three routes do, all cases where the verb is a transport
    detail rather than a portfolio write — `/api/bree` (a query needing a body),
    `/api/feedback` (sends a Slack message), `/api/notifications/[id]/read` (a
    per-user read receipt). A test pins that list, so a fourth opt-out has to be
    added on purpose.
  - **Platform admins are exempt**, whatever their own row's role says:
    cross-tenant correction is the point of the flag, and `crossTenant` already
    governs which company they may touch.
  - `admin` is still required by Slack install and alert preferences. The
    explicit viewer check in `/api/email/inbox/[id]` is now redundant with the
    shared gate and kept only as defence in depth.

## Platform admin

- Cross-tenant access for BrandVault operations (onboarding, data correction).
- Platform admin edits require a reason and are audit-logged separately.
- Customer activity feed shows "Updated by BrandVault Support" for admin changes.

## Onboarding model (first ~10-15 customers)

Concierge. Mark enters data via platform admin. No CSV self-service import
at MEV — that's built later when concierge stops scaling.

## Build plan

Status (2026-07-06): **Phases 1–4 complete and live in production**
(brandvault-asos.vercel.app · Azure Database for MySQL · Clerk). See
`brandvault-mev-build-plan.txt` for the full plan; Phases 5–7 remain.

Bree/Slack **verified live 2026-07-08** (LawPanel workspace): slash commands,
weekly digest, renewal alerts + `alert_sent` dedup, email-fallback graceful-skip.
Fixes that session: slash-command cold-start timeout (ack immediately, deliver
via Slack `response_url` using `@vercel/functions` `waitUntil`); enterprise tone
(decorative emoji removed); Bree app icon on every message (self-hosted
`public/bree-icon.png` as `icon_url`, so digests/alerts match the slash-reply
avatar). SMTP email channel not wired (alerts count and skip email gracefully).

**Live-verified 2026-07-14 (LawPanel workspace, production):**
- Alert round-trip — a real renewal alert (Slack message → "See in app →" deep
  link → dashboard lands with the Bree panel open on the mark → notification
  marked read) and `alert_sent` no-duplicate on a second run. (Triggered
  legitimately by temporarily widening a threshold, then restored — no fake data.)
- Inbound email end-to-end — a `renewal_confirmation` email classified HIGH,
  matched the mark by reference, **proposed** (no mutation), posted a Slack
  Approve/Reject; on Approve the deployed `/api/slack/interactivity` handler
  completed the deadline and audited it with proposer `Bree` + approver
  `Slack:<user>`. Test artifacts purged; the touched deadline was restored.

The Phase-3 approval-flow foundation is now **live for inbound mutations**
(2026-07-14): `/api/slack/interactivity` handles real Approve/Reject buttons —
see the Phase 4 note below. SMTP email channel still not wired.

1. Backend + Auth + Platform Admin — ✅
2. Platform Admin tools + Mark Editing (bulk entry, completeness) — ✅
3. Bree (Slack) + alerts — ✅ live-verified (Slack; SMTP email deferred)
4. Email Integration (Bree Inbound) — ✅ forwarding-address ingestion
   (Postmark) → content-first classification (Claude, claude-sonnet-4-6) →
   route by confidence + reconcile renewals → Bree Slack alerts →
   /inbox human review with corpus feedback. Spec:
   `brandvault-phase4-email-integration.txt`.

   **Auto-act design — REVISED 2026-07-14 (propose-and-approve).** The original
   "HIGH-confidence auto-actions" design let a matched HIGH-confidence email
   mutate mark data directly (audit + alert happened *after* the write). This is
   superseded because the write, not just the notice, is what matters:
   - `renewal_confirmation` **never** auto-completes a renewal deadline — a
     wrongly-completed renewal silently silences a live obligation, the worst
     failure this product can produce. It always creates a pending `Approval`
     and posts a Slack Approve/Reject message; the deadline is completed only on
     approval, audited with proposer (`Bree`) **and** approver (`Slack:<user>`).
   - `registration_certificate` uses the same gate by default, behind
     `AUTO_ACT_REGISTRATION` (see env table) so it can be promoted back to
     auto-act once HIGH-confidence precision on real mail is measured.
   - `renewal_reminder` is reconcile-only (reads + alerts, no mutation) and
     stays automatic. Alert-only types (examination/opposition/etc.) unchanged.
   Mechanism: `lib/approvals.ts` (propose/apply/reject, optimistic-lock
   idempotent) · `lib/email-config.ts` (`autoActEnabled`) · `Approval` model +
   `inbound_emails.status = 'awaiting_approval'` · `/api/slack/interactivity`.

Post-MEV, not started: 5. CSV self-service import · 6. Bree command surface
expansion · 7. Multi-jurisdiction rules + teams.

## Device-mark images

The seven GB figurative marks render their actual mark image in the avatar tile
and the detail header, from `trademarks.image_url`. Everything else keeps a
plain coloured tile with no lettering: initials read to an IP audience as a
mark's logo or device version, which is misleading for a word mark.

- **Images are served from the LawPanel CDN** (`lawpanel-data.azureedge.net`).
  This is a deliberate ONE-DIRECTIONAL dependency: BrandVault reads, never
  writes, and a CDN outage degrades to the plain tile rather than breaking a
  view. When the facade is built, its contract gains an `imageUrl` field and
  BrandVault reads the URL from there instead of holding its own copy.
- **URLs are stored verbatim, never templated.** `UK00002182599` is served as
  `UK00002182599_1_0.jpg`, which no `{appnum}.jpg` rule would produce. The
  mapping is fixed data in `scripts/load-device-images.ts`, and a test asserts
  that entry has not been replaced by a rule.
- `image_url` is null on almost every record and is deliberately NOT part of
  completeness scoring. Its absence is normal, not a gap.

## Intake taxonomy

`COMMUNICATION_TYPES` in `lib/email-types.ts` has already drifted past the "v1
taxonomy" its own comment describes: `watch_notice` and `opposition_procedural`
were both added after it was written. Treat that comment as history, not as the
current list.

`watch_notice` is the first type to get a **persistence model and a view** of
its own rather than an alert alone: third-party filing notices anchor a
`WatchNotice` row to the cited customer mark and open a side-by-side comparison.
It stays **alert-only**. Nothing in this path mutates mark data, nothing
proposes an approval, and no flag promotes it to auto-act.

Two rules it establishes for anything that follows:

- **Anchor on cited numbers, never on mark text.** `lib/watch-notices.ts`
  resolves the customer mark from the application number the notice quotes. A
  cited number matching nothing in the portfolio produces no notice at all and
  routes alert-only to `/inbox` with a "no matching right" note. Mark-text
  matching is not implemented and must not be added: "Assos" against "ASOS" is
  exactly the case where a string-similarity guess attaches a notice to the
  wrong right.
- **Present the conflict, do not assess it.** The comparison view computes a
  class-number set intersection and nothing else. No similarity score, no
  likelihood-of-confusion indicator, no recommended action. A test asserts those
  words do not appear.

## Renewal date invariant

Renewal deadlines reconcile registry expiry against the calculated date.
Disagreements are flagged, never silently resolved. The earlier future date
governs alerts. A live registry status overrides a past calculated date. No
age-based trust rules.

Implemented in `lib/reconciliation.ts` (pure) and applied in `recalcDeadlines`
(`lib/deadlines.ts`). The obligation engine in `lib/utils.ts` is unchanged: it
still derives dates from filing/registration, and reconciliation shapes what it
returned rather than altering how it derives. `scripts/reconcile-report.ts` is
the read-only before/after check; run it before any recalc of a live portfolio.

The reason this exists: on the 2026-07-24 GB load, 38 of 205 ASOS marks with a
registry expiry had no calculated renewal on that date, because the engine's
term grid runs from the filing date and the true expiry does not always sit on
it. Two of them (TOPMAN BRANDED, HOT SHOP) were the most urgent marks in the
portfolio and could never alert: their only rows were one in the past and one a
decade out.

## Outstanding / deferred

- **Specification-versus-specification comparison in the watch view: READY TO
  BUILD.** The blocker was believed to be missing data. It was not. A previous
  entry here claimed the GB export's descriptions were never loaded and queued a
  backfill; that was wrong, and the backfill is deleted rather than deferred.
  `scripts/load-gb-execute.ts:122` writes `text: g.description`, and production
  holds **1,085 goods rows averaging 2,656 characters** (measured 2026-07-28).
  The confusion was the column name: the model field is `GoodsService.text`, not
  `description`, so a check against `description` reads as null.

  Two consequences. Completeness prompts and any spec-vs-spec comparison have
  the data they need today. And that prose is heavy: it was the bulk of the
  3.0MB `/api/trademarks` response, which is why the list payload now carries
  class numbers only and the full record is fetched per mark.

- **Deadline engine does not gate on mark status (post-demo product issue).**
  `getObligationsForTrademark` derives UKIPO renewals from the **filing** date
  (`termFrom: filing`) and nothing anywhere — engine, `recalcDeadlines`, or any
  API caller — checks the mark's status first. So a dead mark with a filing date
  is given live renewal deadlines. The fabricated seed never exposed this because
  it contained no dead marks; the 2026-07-24 GB load hit it immediately (6
  `Withdrawn` marks would have received 12 spurious renewal deadlines).
  Worked around in `scripts/gb-transform.ts` (`NO_DEADLINE_STATUSES` suppresses
  generation for `Abandoned`/`Expired`) rather than in the engine, which is
  preserved code. **This needs fixing in the engine before any further registry
  import** — the loader gate only protects marks that come through that loader,
  not marks edited to a dead status in the app.

- **Inbound sender verification (security).** Nothing currently confirms an
  inbound email actually came from a registry. `POSTMARK_INBOUND_SECRET`
  authenticates the *webhook* (Postmark → us), not the *sender* — a spoofed
  "registry" email forwarded to a company's Bree address would be classified and
  could drive an approval prompt. Before real customers: verify sender (SPF/DKIM
  pass on the original, allow-list registry domains, or a trusted-forwarder
  check) and surface unverified senders in the approval/review UI.
- SMTP email alert channel not wired (alerts count + skip email gracefully).
- Shared Preview/Prod Azure DB — separate before the first external customer.
- **Dashboard load latency — RESOLVED 2026-07-28, one item remaining.** See
  "Hosting region" above for the cause and the fix. Shipped in `34b7e23`:
  region pinned to `fra1`, the `/api/trademarks` payload slimmed to class
  numbers with the full record fetched per mark, the duplicate
  `/api/notifications` fetch removed, stale-while-revalidate on the dashboard
  payloads, and skeletons on the first uncached load. Confirmed markedly faster
  in production.

  Still open: **connection reuse, Vercel to Azure Prisma.** Each cold function
  instance still opens its own pool and a strict-TLS handshake
  (`connection_limit=5` in `DATABASE_URL`). The region pin shortened every one
  of those round trips but did not remove them, so a pooler or Prisma Accelerate
  is still worth weighing against tuning the pool bound. Decide **alongside the
  Preview/Prod database split above**, since both rewrite `DATABASE_URL`.

- **Repo-wide button styling audit (Preflight disabled; native chrome leaking
  on bare buttons).** `corePlugins.preflight` is off in `tailwind.config.ts`, so
  Tailwind never emits the base reset that strips a `<button>`'s user-agent
  border and background. A bare `<button>` styled only with utilities can
  therefore render with the browser's own button chrome underneath. Spotted
  while rendering the Bree panel footer against the built stylesheet. Not
  chased: if the production Send button looks right today then nothing is
  visibly broken, and this keeps until a deliberate styling pass. Queued.

- **Feedback fallback store (small table) when a non-Slack company exists.**
  `/api/feedback` posts to the company's Slack channel and stores nothing: the
  Slack message is the record. A company with Slack unconnected therefore has
  nowhere for feedback to go, so the route returns `delivered: false` and the
  Bree panel says it was not sent rather than thanking the user. Known and
  accepted while every company is Slack-connected. Queued, not built.

- **Watch notices are Slack-only: the app has no awareness surface.** A watch
  notice anchors a `WatchNotice` row and posts a Bree alert, but writes no
  `Notification` — `createNotification` is called only from `lib/alerts.ts`
  (renewal alert, status change, digest), while the processor's watch path calls
  a local `alert()` that is `sendBree` alone. So a filing notice never reaches
  the BreePanel threads bar the way a renewal alert does, and there is no
  portfolio-level view of open notices. The comparison view at `/watch/[id]` is
  the *decision* surface; what is missing is the surface that tells someone a
  decision is waiting. A GC who missed the Slack message cannot discover a live
  opposition window. Queued:
  1. Watch alerts write `Notification` rows like renewals do (type badge + deep
     link), so there is one alert pipeline rather than a Slack-only side path.
  2. A portfolio-level surface for open notices. Dashboard intelligence-panel
     line first ("1 open filing notice, opposition window closes in 30 days",
     urgency-styled like the renewal line); a Watch section listing notices by
     opposition deadline, soonest first, only when volume justifies it.
  3. The mark-detail entry point stays as is.
  Alert-only throughout, unchanged: nothing in this path mutates mark data,
  proposes an approval, or assesses the conflict.

## Deep-link landings

Where a Slack link puts you. One landing per kind of message, defined and parsed
in `lib/deep-links.ts` so the writer and the reader of a link cannot drift.

| Message | Link | Lands |
|---|---|---|
| Mark-specific reply (`/bree status`) | `?q=<text>` | dashboard, search-filtered |
| Summary replies (`/bree renewals`, `/bree portfolio`) | `?bree=1` | dashboard, Bree panel open |
| Notification alerts + weekly digest | `?notification=<id>` | panel open, on that item |

- `?q=` initialises the **existing** search state. No new route and no new UI:
  the arrival is identical to typing that text in the search bar, which is a
  substring match across mark text, numbers, registry, status and agent. So
  `?q=TOPSHOP` legitimately shows TOPSHOP and TOPSHOP UNIQUE together. The link
  carries the text the user asked Bree about, not a resolved mark name. A `q`
  matching nothing shows the search's ordinary empty state, and arrival is
  company-scoped like every other route.
- `?bree=1` rather than reusing the digest's link. The digest lands panel-open
  because it writes a `Notification` row and links to it; a slash command is a
  read-only question, so minting a row per `/bree renewals` would put a thread
  in the panel for every question anyone asks. The param reaches the same
  landing through the `breeOpen` state the panel already has.
- Params are read in an effect, not in initial state: the server prerender has
  no URL, so seeding from `window` there would be a hydration mismatch.

## Naming

- The Slack assistant is called **Bree**.
- Always refer to the founder as a **lawyer**, never attorney.

## Working style

- Be specific about what you're going to do BEFORE doing it.
- Warn before destructive operations.
- Don't repeat failed approaches — change tack.
- Take corrections immediately.
- Never invent names or details not in the codebase or project docs.

## GitHub accounts

This repo is under the **Mark-trustaila** account, but the gh/terminal default is
**Markk-w**, which has only *read* access here. Pushing or opening PRs requires
switching first:

```bash
gh auth switch --user Mark-trustaila   # push / PR on this repo
gh auth switch --user Markk-w          # switch back (default; LawPanel repos)
```

If Mark-trustaila isn't authenticated, add it once with `gh auth login`.
`git fetch`/clone work as Markk-w without switching — only writes need Mark-trustaila.
