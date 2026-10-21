# BuyWise — Phase 1 (Real Data Only)

Production-oriented multi-agent procurement automation on **n8n + Docker + PostgreSQL + Ollama**.
Phase 1 scope: infrastructure, real Tool Gateway, intake, orchestrator, Product + Vendor Research agents, state, audit.
**Strict rule: no mock/fake data anywhere.** Missing data → `UNAVAILABLE`, never invented.

## Deliverables (Phase 1)

```
docker-compose.yml  .env.example  .gitignore  README.md
sql/01-schema.sql
schemas/procurement-request.schema.json  schemas/product-research-output.schema.json  schemas/vendor-research-output.schema.json
prompts/product-research.system.md  prompts/vendor-research.system.md
tools/_lib/envelope.js
tools/{web-search,product-search,product-details,vendor-search,price-retrieval}/{adapter.js,interface.json}
n8n/workflows/{00-orchestrator-buywise,10-agent-product-research,20-agent-vendor-research,90-util-state-manager,92-util-tool-gateway,93-util-logger}.json
tests/test_phase1.py  tests/gateway.unavailable.test.mjs
```

Phase 2 (NOT implemented): Review & Quality, Comparison, Decision, Negotiation, Re-evaluation, Approval agents.

## Quickstart

```powershell
Copy-Item .env.example .env   # then fill POSTGRES_PASSWORD + N8N_ENCRYPTION_KEY (required)
docker compose up -d postgres ollama
docker exec buywise-ollama ollama pull llama3.2:3b
docker compose up -d n8n
# n8n UI: http://localhost:5678 — import n8n/workflows/*.json in dependency order:
# 90, 92, 93, 10, 20, then 00. Reconnect credentials (below), then activate 00.
```

## Credentials — where each one goes (never in code/prompts/git)

| Credential | Get it at | Enter it in |
|---|---|---|
| `POSTGRES_PASSWORD`, `N8N_ENCRYPTION_KEY` | you generate | `.env` only |
| `TAVILY_API_KEY` | https://app.tavily.com (free 1000 credits/mo) | `.env` + n8n HTTP Header Auth `Authorization: Bearer <key>` on gateway Tavily nodes |
| `EBAY_APP_ID` / `EBAY_CERT_ID` | https://developer.ebay.com (free app) | `.env` + n8n HTTP Basic Auth on `eBay OAuth Token` node |
| `SERPAPI_API_KEY` (optional fallback) | https://serpapi.com (free 250/mo) | `.env` only; system works without it |
| `YELP_API_KEY` (Phase 2 reviews) | https://developer.yelp.com | `.env` only (stored for Phase 2) |
| Gmail OAuth2 (Phase 2 negotiation) | Google Cloud Console → n8n Gmail node | n8n Gmail credential on future negotiation workflow; sender identity comes from that credential, never hard-coded |
| Ollama | none (local) | n8n Ollama credential host `http://ollama:11434`, model from env `LLM_MODEL` (default `llama3.2:3b`) |

Missing provider key → gateway returns `{data_status: UNAVAILABLE, retryable: false}`, orchestrator continues partial or escalates. Amazon/Flipkart are excluded in Phase 1 (no scraping, no fabricated prices).

## API

`POST http://localhost:5678/webhook/procurement-request` with `schemas/procurement-request.schema.json`, e.g.
`{"requirement":"15 office laptops 16GB RAM","quantity":15,"budget":20000,"currency":"USD","mandatory_specs":{"ram_gb":16}}`.

## Tests (no fake data)

```powershell
python3 tests/test_phase1.py            # JSON validity, schemas, validation rules, SQL, workflow wiring
node tests/gateway.unavailable.test.mjs # empty creds -> UNAVAILABLE for all 5 adapters, exclusion enforced
docker compose config                   # compose validity
```

## Validation report (filled at implementation time — see final message)

Services, schema, workflows, Ollama, adapters, env/credentials, provider connection results, problems.

## Provider strategy (post-upgrade)

**SerpAPI Google Shopping** (primary commercial: listings, merchants, prices, ratings) +
**Tavily** (web research, specs, official pages, warranty/shipping evidence).
**eBay is NOT REQUIRED** and inactive (`EBAY_ENABLED=false`); code retained for audit
history. Gmail **UNAVAILABLE** (send gate stays blocked), Ollama **UNAVAILABLE**
(all logic deterministic). Offers exist only with product + merchant + numeric price +
known currency + source URL (`tools/_lib/commercial.js`); SerpAPI ratings attach to
products same-subject only; currencies come from explicit symbols/codes, never guessed.

```powershell
node tests/commercial_run.mjs   # fresh end-to-end procurement (uses .env keys silently)
node tests/serpapi.unit.test.mjs; node tests/commercial.unit.test.mjs
node tests/provider.integration.test.mjs; python3 tests/test_provider_policy.py
```

### n8n cross-workflow references (important)

Repo workflow files reference sub-workflows by **name** (portable across installs).
n8n 1.107 resolves sub-workflow calls only by internal **ID** at runtime, so after
importing or re-importing workflows, run:

```powershell
python3 tools/n8n_relink.py   # rewrites every execute/toolWorkflow ref to live IDs (idempotent)
```

then restart n8n (`docker compose restart n8n`). Never paste workflow IDs into repo
files — they are instance-specific.

Objective: prove Phase 1 retrieves and persists real procurement data with zero mocks.
No Phase 2 agents. Ollama is NOT required (orchestrator is LLM-free; see below).

### 1. Configure credentials (never hardcode, never commit)

```powershell
Copy-Item .env.example .env   # only when you have keys to put in it
```

Fill in `.env` (all optional except Postgres/n8n core; missing provider key = `UNAVAILABLE` by design):

| Variable | Source | Status values in reports |
|---|---|---|
| `TAVILY_API_KEY` | https://app.tavily.com (free 1000 credits/mo) | `configured` / `absent` |
| `EBAY_APP_ID` + `EBAY_CERT_ID` | https://developer.ebay.com (free app) | `configured` / `absent` |
| `SERPAPI_API_KEY` | https://serpapi.com (optional fallback) | `configured` / `absent` |
| `YELP_API_KEY` | deferred to Phase 2 | `DEFERRED` |

Mirror provider keys into n8n Credentials for the gateway workflow: HTTP Header Auth
(`Authorization: Bearer <TAVILY_API_KEY>`) on Tavily nodes, HTTP Basic Auth
(`EBAY_APP_ID`/`EBAY_CERT_ID`) on the `eBay OAuth Token` node. `.env` is gitignored;
secret values are never printed in reports.

### 2. Start services

```powershell
docker compose up -d postgres n8n   # ollama intentionally excluded on low-RAM hosts
Invoke-WebRequest http://localhost:5678/healthz -UseBasicParsing
```

### 3. Run provider connectivity + failure tests

```powershell
node tests/live_providers.test.mjs    # real requests; SKIPPED_NOT_CONFIGURED per provider without keys
node tests/gateway.failure.test.mjs   # invalid creds vs real endpoints -> must be UNAVAILABLE
node tests/gateway.unavailable.test.mjs
python3 tests/test_phase1.py
python3 tests/test_phase15_offline.py
```

Without credentials the correct live result is `0 PASS, 0 FAIL, N SKIPPED_NOT_CONFIGURED`
and any procurement run must yield `0` products/offers with `UNAVAILABLE` — never invented data.

### 4. Run the real procurement test

With keys configured, execute the documented test input (business laptops, 16GB/512GB,
budget ₹80,000/unit) through `productSearch`/`vendorSearch` adapters or the n8n
orchestrator (`00-orchestrator-buywise`), then inspect PostgreSQL:

```powershell
docker exec buywise-postgres psql -U buywise -d buywise -c "SELECT count(*) FROM products;"
docker exec buywise-postgres psql -U buywise -d buywise -c "SELECT offer_id,unit_price,currency,data_status,source_url,retrieved_at FROM offers LIMIT 5;"
```

Every LIVE row must trace `record -> provider -> source_url -> retrieved_at`.
Missing fields stay `"unavailable"`; currencies are never converted (no FX source configured).
n8n executions: n8n UI -> Executions (filter `00-orchestrator-buywise`).

### 5. Security precautions

Keys live in `.env` + n8n Credentials only. `tests/test_phase15_offline.py` includes a
repo secret scan; the sole `tvly-…` string in the repo is the deliberate
`tvly-INVALID-KEY-FOR-FAILURE-TEST` sentinel (not a real credential).

## Phase 2A — Review, Quality, Comparison & Deterministic Scoring

Pipeline: `products → 40-agent-review-quality → 50-agent-comparison → 60-util-scoring-engine → ranked candidates`.
No Decision/Negotiation/Approval agents. Works WITHOUT any LLM: tiers, completeness,
scoring, ranking are deterministic code (canonical libs `tools/_lib/source_quality.js`,
`tools/_lib/evidence.js`, `tools/_lib/scoring.js`; n8n Code nodes embed the same algorithms).

### Missing-data policy (renormalization, never zero-fill)

A criterion with no verified evidence is EXCLUDED from numerator AND denominator;
weights renormalize over available criteria. Stored per row: `criteria_used`,
`criteria_missing`, `effective_weight_total`. `overall_score = null` means "no basis",
never "bad". Verified live: excluding missing beats naive zero-fill.

### Scoring formula

`overall = Σ(wᵢ·sᵢ) / Σ(wᵢ)` over available criteria only. Component normalizers:
rating/scale (explicit numeric rating only), budget 1/0 only with same-currency verified
price (no FX → no verdict), source tier + spec completeness always computable.
Ranking: score desc, nulls last, confidence desc, `product_id` asc — reproducible.

### Source-quality policy (evidence strength, NOT product quality)

HIGH manufacturer 1.0 (dell/hp/lenovo…), HIGH major retailer 0.9, MEDIUM specialist 0.8 /
publication 0.6 / video 0.4, LOW social/unknown 0.3. Overridable via
`scoring_configs.source_quality_map`. Weak sources stay visible as LOW, never deleted/upgraded.

### Review policy (attribution-gated)

A rating attaches to a candidate ONLY with (a) product-context tokens from the
requirement and (b) exactly one rating pattern in the snippet (multiple patterns =
ambiguous list page → rejected; platform ratings misattributed → rejected with reason
in `quality_evidence`). Otherwise `review_rating`/`review_count` stay `unavailable` (NULL).

### Weight configuration

Defaults in `tools/_lib/scoring.js` (`DEFAULT_WEIGHTS`); per-procurement overrides via
procurement `weights` → `scoring_configs` table. Unknown/negative/non-numeric weights rejected.

### Run + tests

```powershell
$env:PGPASSWORD="<postgres pw>"; node tests/phase2a_run.mjs   # live 9-product pipeline
node tests/scoring.unit.test.mjs        # 57 deterministic unit tests (fixtures, never LIVE)
python3 tests/test_phase2a_policy.py    # schemas, workflows, migration, secret scan (excludes .env)
```

### Current limitations

`price/vendor/delivery/warranty/payment_terms/budget_compliance` are `unavailable`
whenever no verified provider data exists (current: no offers — eBay PENDING_APPROVAL).
Rankings on thin evidence rank *evidence quality*, not product goodness.

## Phase 2B — Decision Agent + Real Negotiation Agent

New: `65-agent-decision`, `70-agent-negotiation`; orchestrator routes
`compared → decided → negotiating` (negotiating ONLY when a real negotiation opens;
`reevaluated/pending_approval/closed` untouched — Phase 2C). No LLM anywhere on this host.

### Decision gates (`tools/_lib/decision.js`, deterministic)

Rank order scan: scoring basis present → verified mandatory specs (unverified mandatory
BLOCKS, never assumed; violations skip the candidate) → verified same-currency offer →
contact channel → budget verdict. Outcomes: `PROCEED` (verified, in-budget, no blocks),
`NEGOTIATE` (verified over-budget + real channel), `INSUFFICIENT_DATA` (otherwise —
the honest result for thin datasets). Scores still come only from the scoring engine.

### Negotiation rules (`tools/_lib/negotiation.js`, never simulated)

A row exists ONLY for verified vendor + offer + price + contact. Targets derive ONLY
from explicit budget/allowed-discount (never assumed %). Drafts use supplied facts only.
`human_confirmation=true` required to send; Phase 2B persists `do_not_send=true` and
never sends. `NOT_READY` persists NOTHING (event `evaluated_not_ready` only, no fake rows).
Duplicates blocked by `UNIQUE(procurement_id, offer_id)`.

### Run + tests

```powershell
$env:PGPASSWORD="<postgres pw>"; node tests/phase2b_run.mjs              # live decision run
node tests/phase2b.integration.test.mjs  # post-state: INSUFFICIENT_DATA, 0 rows, decided
node tests/decision.unit.test.mjs; node tests/negotiation.unit.test.mjs
python3 tests/test_phase2b_policy.py
```

### Current limitations

No verified offers/vendors on the live dataset → `INSUFFICIENT_DATA` + `NOT_READY`
(by design, not failure). Gmail sending + vendor responses + re-evaluation + approval
are Phase 2C. eBay PENDING_APPROVAL, Ollama UNAVAILABLE.

## Phase 2C — Re-evaluation Agent + Approval Agent (final phase)

`80-agent-reevaluation` recomputes via `60-util-scoring-engine` (called twice:
original + revised) on VERIFIED vendor responses only (email/API/portal with price,
currency, timestamp, evidence). No response → `WAITING_FOR_VENDOR`, no rows, no
transition. Savings need two real same-currency prices or stay unavailable.
`90-agent-approval` builds the 19-section package (gaps stay `unavailable`) and
pauses at a human-in-the-loop Wait webhook; only explicit `APPROVED`/`REJECTED`/
`CHANGES_REQUESTED` with a real actor identity counts — never absence/timeout/views.
Closure only on explicit outcomes (or the explicit `decided→closed` PROCEED rule,
default off). No purchase orders, payments, or execution — the system ends at CLOSED.

```powershell
$env:PGPASSWORD="<postgres pw>"; node tests/phase2c_run.mjs              # live gate run
node tests/phase2c.integration.test.mjs  # reevaluations 0, approvals 0, still decided
node tests/reevaluation.unit.test.mjs; node tests/approval.unit.test.mjs
python3 tests/test_phase2c_policy.py
```

Canonical libs: `tools/_lib/reevaluation.js` (reuses scoring, never duplicates),
`tools/_lib/approval.js` (package/actor/closure guards). Migration `05-phase2c-schema.sql`
(`reevaluations`, `approvals`, `approval_events`; states through `closed`).

### Known live-data outcome

Dataset `ac07e16d` has no negotiations/responses → `NOT_ELIGIBLE` + `NOT_CREATED`,
state stays `decided`, production tables byte-identical (verified programmatically).
Thin-evidence honesty is the feature, not a gap: eBay PENDING_APPROVAL, Ollama
UNAVAILABLE, Gmail not connected.

## Demo mode (local end-to-end demonstration, no vendor contact)

REAL mode is the default and still blocks without verified contact channels.
DEMO is explicit only (`selectMode` requires a reason) and stored per case
(`procurement_cases.mode`, `negotiations.mode`, `reevaluations.mode`,
`approvals.mode`). Flow: `decided → demo_negotiating → demo_response_received →
reevaluated → pending_approval → closed`, reusing the existing Decision,
Negotiation (proposal only, `do_not_send`), Re-evaluation (same engine),
Approval (same human gate), and scoring engine — no new agents.

Rules: human-entered responses only (n8n `75-demo-response` form or explicit
operator values), always `DEMO_HUMAN_ENTERED` / `LOCAL_DEMO_INPUT` /
`vendor_response_verified=false`; `VENDOR_RESPONSE_RECEIVED` and
`vendor_response_verified=true` can never appear on demo records (unit-pinned);
nothing is ever sent. Migration `06-demo-mode.sql` (`demo_responses` table).

```powershell
$env:PGPASSWORD="<postgres pw>"
node tests/commercial_run.mjs   # fresh REAL case first (stops honestly at decided)
$env:DEMO_PROC="<id>"; $env:DEMO_OFFER="<offer>"; $env:DEMO_PRICE=48500; $env:DEMO_CCY="INR"
$env:DEMO_DECISION="APPROVED"; $env:DEMO_ACTOR="Demo Operator"; node tests/demo_run.mjs
node tests/demo.unit.test.mjs; python3 tests/test_demo_policy.py
```

## Provider strategy (SerpAPI primary, eBay NOT REQUIRED)

**SerpAPI Google Shopping** (listings, merchants, prices, ratings) + **Tavily** (web
research, specs, official pages, warranty/shipping evidence). **eBay is NOT REQUIRED**
and inactive (`EBAY_ENABLED=false`); its code is retained for audit history only.
Gmail **UNAVAILABLE** (send gate stays blocked), Ollama **UNAVAILABLE** (all logic
deterministic). An `offer` row exists only with product + merchant + numeric price +
known currency + source URL (`tools/_lib/commercial.js`); SerpAPI ratings attach to
products same-subject only; currencies come from explicit symbols/codes, never guessed.

Live findings (documented, not worked around): SerpAPI defaults to Indian locale
(`gl=in`, `hl=en`; overridable via `SERPAPI_GL`/`SERPAPI_HL`/`SERPAPI_LOCATION`) —
pass locale params for regional catalogs; INR budgets vs non-INR offers correctly
yield unavailable budget compliance (no FX). Shopping `link` fields are
Google redirect URLs, so product identity uses the SerpAPI product cluster id first
and never URL-strips redirectors (see `productIdentity`). Specs verify only from
explicit single-value statements on same-subject pages (`extractSpecs`); contact
emails only from the vendor's own domain (`contactHostMatches`) — third-party
directories are evidence, never channels. Decision scans all ranks for the first
fully-clearing candidate; stored `blocking_reasons` always cite rank-1 evidence.

```powershell
$env:PGPASSWORD="<postgres pw>"; node tests/commercial_run.mjs   # fresh end-to-end procurement (keys via .env, never printed)
node tests/serpapi.unit.test.mjs; node tests/commercial.unit.test.mjs
node tests/provider.integration.test.mjs; python3 tests/test_provider_policy.py
```

## Website — BuyWise Procurement Console (interactive demo UI)

`web/` is a small Express app over the **real** PostgreSQL database. No mocks, no fake
data, no email sending. Everything shown comes from live tables; everything written
goes through the same validation rules as the n8n agents. Rankings, scores and
decisions are always read from backend rows — the frontend never computes them.

### Start commands (exact)

```powershell
docker compose up -d postgres n8n          # database + orchestrator (from D:\flexi)
cd D:\flexi\web; npm install               # first time only
npm start                                  # serves http://localhost:8080
```

Website URL: **http://localhost:8080**

New-procurement submissions proxy to the live n8n intake webhook
(`http://localhost:5678/webhook/procurement-request`, override with `N8N_WEBHOOK_URL`),
so n8n must be up for that button. All other actions read/write Postgres directly
with parameterized queries. The server binds `127.0.0.1` — local demo tool, no auth;
do not expose it to a network without adding auth first.

### Environment variables (website only)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | website listen port |
| `N8N_WEBHOOK_URL` | `http://localhost:5678/webhook/procurement-request` | live intake webhook |
| `PGHOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `localhost` / `.env` values | Postgres connection (`.env` in `D:\flexi`, never committed, never sent to the browser) |

Provider API keys are never read by the web server and never leave the server
(presence-only flags in `/api/providers`; `safeJson` guard refuses secret-shaped
output; verified by `npm test` in `web/`).

### Pages

- **Dashboard** (`#/`) — live totals, active/closed/awaiting-approval counts, recent
  runs, provider connectivity & health, recent agent executions, recent decisions,
  prominent “New Procurement” action. Honest empty states when no cases exist.
- **New procurement** (`#/new`) — validated wizard (product/category, requirements,
  quantity, budget, currency default INR, mandatory specs, delivery, warranty,
  constraints, REAL default / DEMO explicit with required reason). Submits the real
  intake and navigates to the new case by its actual ID.
- **Case workspace** (`#/case/:id`) — opens on an Overview card (requirement,
  quantity/budget in ₹, live counts, decision + short reason, reasoning mode, one
  state-dependent primary action, copyable short ID) above a collapsed 9-step
  stepper. Each step shows one result line + reason + `View details` (lazy-loaded,
  never all expanded at once); scoring is labelled deterministic code.
  Deep browsing stays in the tab routes (`#/case/:id/:tab`): Overview, Agent
  Workflow, Products (search/sort/paged), Vendors & Offers (Merchant/Product/
  Price-in-₹/Evidence/`View source`, search/sort/paged, unique-merchant count),
  Quality & Evidence, Comparison & Scoring (top-3 cards + collapsible full
  criteria), Decision (outcome hero), Negotiation, Re-evaluation, Approval
  (explicit DEMO–NOT VERIFIED banner in DEMO mode), Agent Trace (filters for
  agent/type/status/reasoning mode, revision loops grouped, raw JSON collapsed),
  Audit Trail.

### Live demonstration guide (one laptop, no vendor contact)

1. Open http://localhost:8080 → Dashboard → **+ New Procurement**.
2. Fill the form (REAL is default), submit → case page opens with the real case ID.
3. Wait ~1–3 min while live research runs (page auto-refreshes; never invents
   progress). Watch the nine-stage workflow move from evidence as rows land.
4. Tabs Products → Vendors & Offers → Quality → Comparison & Scoring → Decision:
   inspect real rows; missing data stays `unavailable`. Expect `INSUFFICIENT_DATA`
   on thin datasets — that is the honest result, shown with blockers.
5. Negotiation tab → switch the case to DEMO (reason required) → Generate
   negotiation proposal (from a real verified offer; `sent:false`,
   `vendors_contacted:0`, `do_not_send:true`).
6. Re-evaluation tab → enter the hypothetical response manually (price, currency,
   delivery, warranty, payment, notes) — stored as `DEMO_HUMAN_ENTERED` /
   `LOCAL_DEMO_INPUT` / `vendor_response_verified=false` with the persistent
   “Simulation only …” notice → **Run re-evaluation** → before/after comparison.
7. Approval tab → Create approval package → APPROVE / REJECT / REQUEST CHANGES
   with explicit confirmation and actor name (DEMO-labeled in demo mode).
8. Audit Trail tab → full chronological history with raw JSON.
9. Refresh the browser at any point — the same procurement ID resumes from the
   database; repeated refreshes create nothing.

### Website tests

```powershell
cd D:\flexi\web; npm test            # 21 live read-only + pure unit tests (needs server up)
node test/e2e-demo.mjs               # full scripted E2E: REAL intake → research → DEMO → re-eval → APPROVE → closed
```

`node test/e2e-demo.mjs` stops honestly with `HONEST STOP` when live research yields
no verified offers (nothing to negotiate — correct REAL behavior). A completed
reference run is case `679a22df-df99-46b1-8abc-08bd8a0ba09b` (full research →
DEMO → APPROVED → closed, 14 coordination messages) — open it in the case
workspace to present the full journey instantly.

## Multi-user access (local RBAC)

The website requires login. Sessions are opaque server-side tokens in
`HttpOnly; SameSite=Lax` cookies (12 h), CSRF-checked on mutations, rate-limited
logins (5 per 5 min per account; `LOGIN_RATE_WINDOW_MS`/`LOGIN_RATE_MAX` env
overrides). Passwords are scrypt-hashed (`tools/_lib/passwords.mjs`); hashes
never leave the server. Roles: **admin** (accounts, roles, limits),
**requester** (create + edit own), **officer** (pipeline, demo, packages, edit
any), **approver** (decide; separation-of-duties, authorization limits, and
version-freshness enforced), **auditor** (read-only). All enforcement is
server-side.

Bootstrap (local, no default password):
```powershell
cd D:\flexi\web
$env:ADMIN_USERNAME = "owner"; $env:ADMIN_PASSWORD = "choose-a-long-secret"
node scripts/create-admin.mjs   # refuses if any user exists
```
Then log in at http://localhost:8080 and create the team in **Admin**.
Requests carry `owner_user_id` + `version`; edits bump the version and audit a
diff; approvals record `request_version`, decide only on a fresh package, and
refuse self-approval, over-limit, and stale decisions. REAL approval on an
`INSUFFICIENT_DATA` case without eligible offers is blocked (422). Single
tenant by design (no org tables) — see `docs/RETROSPECTIVE.md` §5.12.

## CA3 evaluation (multi-agent system evidence)

Artifacts in `docs/`: `PROJECT_SYNOPSIS.md`, `DESIGN_DOCUMENT.md`,
`INPUT_OUTPUT_DEFINITIONS.md`, `AGENT_EXECUTION_TRACE.md`, `CA3_DEMO_GUIDE.md`,
`CA3_RUBRIC_EVIDENCE.md`, `CA3_GAP_ANALYSIS.md`.

- **Coordination trace**: every pipeline run persists task/evidence/revision/
  decision/escalation messages to `agent_messages` (migration
  `sql/07-agent-coordination.sql`, contract `tools/_lib/coordination.js`).
  Inspect per case: website **Agent Trace** tab or
  `GET /api/cases/:id/trace`. Reference loops: case `b604039e-…`
  (revision_request → follow-up → decision recompute), case `679a22df-…`
  (full research → DEMO → APPROVED → closed, 14 messages).
- **Optional LLM reasoning (advisory only)**: set `LLM_PROVIDER=openai-compatible`
  + `LLM_API_URL` + `LLM_API_KEY` + `LLM_MODEL` in `.env` (never logged/stored).
  Decision/Comparison agents attach one validated advisory; gates and scores stay
  deterministic; failures resolve to labelled `DETERMINISTIC_FALLBACK`.
  Indicator: `GET /api/reasoning-mode` + website sidebar/Pipeline/Trace chips.
  Default (no creds): `LLM_UNAVAILABLE`. No live hosted credentials are
  configured — live LLM execution is unverified (stub-verified only).
- **Bounded adaptation**: max 1 auto-replan per case
  (`MAX_REPLANS_PER_CASE`), 1 tool retry, 15 s provider timeouts, 20 kb message
  cap; agents have no vendor-contact tool; scoring engine stays read-only.
- **Tests**: `node tests/coordination.unit.test.mjs` (24 contract tests),
  `node tests/llm.unit.test.mjs` (24 provider/contract tests, mocked — no network),
  `node tests/passwords.unit.test.mjs` (12 hashing/validation tests),
  `cd web; npm test` (36: API + 14-test auth matrix covering unauthenticated,
  roles, CSRF, SoD, stale, limits, deactivation, idempotency, rate limits).
  Regression: scoring/demo/decision/negotiation/reevaluation/approval/commercial/
  serpapi unit suites (257 pass) + `tests/test_demo_policy.py` + `tests/test_phase1.py`.
- **Manual steps before demo day**: (1) no n8n reimport needed — the
  `Op Persist Offers` fix is already applied to the running instance (verified:
  fresh intake → real offers → decided); only reimport
  `n8n/workflows/00-orchestrator-buywise.json` + `python3 tools/n8n_relink.py` +
  restart n8n if n8n is ever reinstalled; (2) keep `docker compose up -d postgres
  n8n` and `npm start` (web) running through the evaluation window.
- **GitHub (individual-contribution marks)**: push this repo, add collaborators
  + `examstudio-bot`, each member sets their own git identity and commits their
  own work steadily with PRs/reviews. Do not rewrite or reattribute history.

## Procurement lifecycle (enforced in backend code)

States (existing names kept): `created → product_done → vendor_done →
quality_done → compared → decided → {negotiating | demo_negotiating →
demo_response_received} → reevaluated → pending_approval → {closed |
changes_requested} → purchase_handoff`. Side branches: `partial` (thin n8n
results), `failed`/`needs_human_intervention` (recoverable). Every website
status write goes through `transitionStatus()` (`web/server.js`) against the
map in `tools/_lib/lifecycle.js`; illegal attempts get HTTP 409 plus a
`transition_rejected` audit event (previously silent no-ops). `closed` and
`purchase_handoff` are terminal. Closure requires a recorded APPROVED/REJECTED;
handoff requires a closed case whose latest approval is APPROVED + REAL (a
DEMO approval is never purchasing authorization).

Decision outcomes (deterministic, `tools/_lib/decision.js`): `PROCEED`
(recommendation supported), `NEGOTIATE` (verified over-budget + channel),
`NO_ELIGIBLE_OFFERS` (empty ranking / all mandatory-failed / zero offers),
`RESEARCH_REQUIRED` (blocked only by fillable gaps), `INSUFFICIENT_DATA`
(structural blocks). Intake is validated with structured errors + clarification
warnings (`created` = draft-equivalent); research starts only after validation.

Eligibility (`eligibility` table, `sql/13-lifecycle.sql`): mandatory
PASS/FAIL/UNKNOWN per product×requirement with evidence, same normalized rules
as the Decision Agent; preferences never gate. Scoring engine
`SCORING_RULES_VERSION=1.0.0` stamped on `scoring_configs`/`comparisons` rows;
recompute-from-stored-inputs tested. REAL proposals are unsent internal drafts
(`POST /api/cases/:id/negotiations`, officer/admin); negotiation never sends.

Access: login required everywhere except login/health/reasoning-mode. Roles
admin/officer/approver/auditor see all cases; requesters see only owned cases
(unknown/invisible IDs answer 404). Mutations need CSRF + role + ownership
where applicable. Docs: `docs/RETROSPECTIVE.md` (audit), `docs/DESIGN_DOCUMENT.md`,
`docs/INPUT_OUTPUT_DEFINITIONS.md`, `docs/AGENT_EXECUTION_TRACE.md`.

Database-enforced invariants (`sql/14-lifecycle-enforcement.sql`, applied):
`trg_lifecycle` rejects illegal status writes from ANY writer including n8n
(mirrors `tools/_lib/lifecycle.js` exactly — verified by
`web/test/db-consistency.test.mjs`); partial unique index guarantees at most
one PENDING approval per case even under concurrent duplicate submissions.
Intake accepts an `Idempotency-Key` header: retries with the same key converge
on one case without re-calling n8n. Operational backup/restore: `docs/OPERATIONS.md`
(backup file + tested restore procedure). Security posture + multi-tenant
migration plan: `docs/SECURITY_AND_TENANCY.md` (local HTTP only — TLS/cookies/
CORS/least-privilege DB roles required before any LAN exposure).
