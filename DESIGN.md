# Pursuit Modeling Platform — Design Document

**Scope:** the pre-sale layer for consulting pursuits — turning a scoped backlog into
a risk-adjusted, defensible, submittable price. Not delivery tracking, not a PSA,
not a proposal generator. The thing that sits in the gap between them.

This document is the *why* behind `schema.sql` and `seed_data.sql`. Read it
alongside the schema, not instead of it — every claim below points at real
tables and columns, not aspiration.

---

## 1. The seven design principles

Everything in the schema traces back to one of these. When a future change
feels awkward to make, it's usually because it's fighting one of them.

1. **One allocation grain.** Every rollup — by pod, by role area, by location,
   by phase — is a `GROUP BY` over `allocations`. Never a separately
   maintained table. This is the single decision that stopped us hand-building
   a new pivot table every time the shape of the question changed.
2. **Append-only where it matters.** Rate cards, allocations, and effort
   estimates are versioned via `superseded_at`, never overwritten. A submitted
   bid's economics can't silently change under it later.
3. **Governance/contingency is structural, not additive.** The bug that cost
   real money mid-session — layering an 8% governance pool *on top of*
   delivery effort instead of carving it *out of* existing pods — is now
   impossible to repeat, because the carve-out is its own `allocations` row
   with `parent_allocation_id` tracing back to exactly what it was cut from.
4. **Cost and fees are resolved at the grain, not at render time.** A rate
   card update next quarter doesn't rewrite the economics of a bid you
   already submitted, because `allocations.resolved_fees` was captured the
   moment that row was written, not recomputed live off a lookup.
5. **Assignment doesn't require a pod.** A named specialist or client-side SME
   is a `resources` row with no pod at all — `allocations` resolves to
   exactly one of `pod_id` / `resource_id`, enforced by a `CHECK` constraint.
6. **Effort estimation is its own entity.** `effort_estimates` sits between
   `capabilities` and `allocations` specifically so a capability can carry a
   bottom-up estimate *and* a parametric one side by side for reconciliation,
   with exactly one flagged `is_selected` as the number that actually feeds
   pricing.
7. **Client-specific vocabulary is data, not schema.** Role areas, location
   buckets, and rate card dimensions are tenant-scoped lookup tables and
   JSONB, never `CHECK` constraints — the six role areas from the first
   engagement modeled here are one tenant's configuration, not a universal
   truth.

---

## 2. Subsystems, in dependency order

### 2.1 Tenancy and the flexibility layer
`tenants` → `role_areas`, `location_buckets` (tenant-scoped) → `canonical_concepts` (the one global table, no `tenant_id` at all).

Every firm's vocabulary differs — what we call "Development" another firm
calls "Build," with a different location tier structure entirely. Rather than
hardcode categories, each tenant configures its own `role_areas` and
`location_buckets` rows. `canonical_concepts` is the shared, platform-owned
anchor: a tenant's `role_areas` row can *optionally* map to a canonical
concept via `canonical_concept_id`. Nothing forces the mapping — a tenant
that never sets it simply doesn't participate in cross-tenant benchmarking on
that dimension. This is the seam where two tenants' data can ever touch, even
indirectly, and it's why the differential privacy layer (2.9) attaches here
and nowhere else.

### 2.2 Rate cards
`rate_cards` (versioned, `tenant_id`-scoped) → `rate_card_entries`.

Descriptive dimensions (this engagement's LOS/staff-class/experience-level;
another firm's practice/band structure) live in `rate_card_entries.dimensions`
as JSONB — different firms organize rate cards along genuinely different
axes, and forcing one shape onto all of them would mean a migration every
time a new firm onboards. The one universal requirement is a resolvable
`rate_key` that every `pod_roles` and `resources` row resolves against, plus
the two numbers everything downstream needs: `target_rate` (bill) and
`rsr_cost` (cost).

### 2.3 Pods and resources — the dual assignment path
`pods` → `pod_parameters` (site hours/day, sprint length) → `pod_roles`
(roster template). Separately: `resources`, for anyone not routed through a
pod at all.

Most effort routes through a pod's fixed roster. Some doesn't — a named
specialist, a client-side SME — and forcing that into a one-person "pod" to
satisfy the schema would be a workaround masquerading as a design. Both paths
produce the same shape (`hrs_per_sprint`, a `rate_key`, a `role_area_id`), so
the rest of the system never needs to know which path a given hour came from.

### 2.4 Bids and capabilities
`bids` (tenant-scoped, carries `target_price`/`target_margin` and the
bid-level `governance_carveout_pct`) → `capabilities` (pure scope metadata —
domain, use case, name, in/out of scope — deliberately carrying zero hours).

### 2.5 Effort estimation
`effort_estimates`, one-to-many off `capabilities`, versioned, with a
`method` (`bottom_up` | `parametric` | `analogy`) and exactly one
`is_selected` row per capability at a time.

This is the answer to "where is efforting" from partway through the build —
hours started as flat columns directly on `capabilities`, which quietly broke
the reconciliation goal established earlier in the same conversation: running
bottom-up and parametric estimates side by side and diffing them before
submission, not after. Splitting effort into its own entity is what makes
that reconciliation query (in `schema.sql`) possible at all.

### 2.6 The allocation grain
`allocations` — the center of the whole model. Two independent dimensions on
every row:

- **who does the work** — `pod_id` XOR `resource_id`, never both, never
  neither (2.3's dual path, enforced here)
- **what kind of row it is** — `direct` (a capability's hours assigned,
  possibly split across two pods by percentage) or `governance_carveout`
  (auto-derived from a direct row, routed to a governance pod, with
  `parent_allocation_id` pointing back to exactly what it was cut from — the
  fix for principle #3)

Every dimensional view in the product — pod rollup, role-area rollup,
location mix, phase breakdown — is a different `GROUP BY` over this one
table. That uniformity is what makes the target-back solver possible: it
reads the same grain the UI renders, so a proposed reallocation and its
effect on the bottom line are never two different calculations that could
quietly disagree.

### 2.7 Bid snapshots
`bid_snapshots` — the full resolved allocation set, frozen as JSONB at the
moment a bid is submitted. Re-pricing an old deal on a new rate card, or
doing honest win/loss analysis, both read from here — never from `allocations`,
which may have been edited since.

### 2.8 Flags
`flags` — deterministic rule output, not a model. Four categories worth
naming: structural integrity (splits that don't sum to 100%, a broken
carve-out invariant), economic sanity (margin below floor, a pod priced 3-4x
every other pod on the bid), duration outliers (a pod's serial sprint count
exceeding anything sane — the kind of number nobody scans forty rows looking
for, which a rule catches mechanically every time), and historical comparison
(thin at one tenant, real once a corpus exists). Every flag carries a plain-
language message naming the driver and, where sensible, routes to the solver
— never a bare error code.

### 2.9 Monte Carlo simulation
`simulation_runs` / `simulation_results` — a parallel analysis pass, not a
pricing step. Everything in 2.6 prices off `hours_likely`, a point value.
Monte Carlo is the only consumer of `hours_low`/`hours_high`: each run
samples a distribution per capability, applies that capability's *existing*
allocation splits and rates, and sums to one iteration's total price across
thousands of iterations. Only the resulting percentiles are persisted — raw
draws are pure noise to store and free to regenerate.

The non-obvious point worth carrying forward: **you cannot get the bid's P80
by summing each capability's individual P80.** Uncertainty partially cancels
across independent capabilities; summing percentiles systematically overstates
risk and pads the price. Simulating is what gets this arithmetic right.

### 2.10 Parametric reference data (COCOMO II)
`parametric_models` / `parametric_model_params` (JSONB calibration constants,
`tenant_id` nullable — null is the published default, a real value is that
firm's own recalibration) / `cost_driver_definitions` (the published rating
tables, deliberately global like `canonical_concepts`) / `capability_
parametric_inputs` (the audit trail — what size, what ratings, what the
resulting hours were).

Seeded with the actual COCOMO II.2000 tables — `A=2.94`, `B=0.91`, all 5 scale
factors, all 17 effort multipliers — verified against the model manual's own
worked example (all-Very-Low scale factors → ΣSF=31.6 → E=1.226 → 832 PM at
100 KSLOC, which the seed data reproduces exactly). One row (`TOOL`'s values
beyond Very Low) is flagged in the seed file as unverified against the
primary source and should be checked before it touches a real price.

### 2.11 Differential privacy / the commons boundary
`canonical_concepts` gains three DP settings (fixed bucket edges, epsilon
cost per query, minimum tenant count) → `privacy_budgets` (per-tenant,
per-concept epsilon ledger) → `benchmark_query_log` (every attempt, served or
refused).

This is not live — it's the design for the moment a second real tenant
exists, built now so the boundary is right from day one rather than
retrofitted. The mechanism: never add noise directly to a percentile (no
clean sensitivity bound — one outlier tenant can shift a median arbitrarily
in a small group); bucket first, add Laplace noise to *counts* (clean,
bounded sensitivity), reconstruct the percentile from the noised histogram.
Gated twice — minimum tenant count, and remaining privacy budget — both
checked *before* any row is read, so a refused query costs nothing and leaks
nothing about the underlying data.

---

## 3. Build phasing (recap)

| Phase | Scope | Gated on |
|---|---|---|
| 0 | License/seed COCOMO II reference data, build canonical mapping stub | Nothing — buildable before tenant one |
| 1 (MVP) | Ledger + grain, versioned rate cards, dual assignment, dimensional rollups, target-back solver, deterministic flags | One real design partner's messy data |
| 2 | Three-point estimates, Monte Carlo P50/P80/P90 | Phase 1 working end to end |
| 3 | Parametric engine as second opinion, actuals reconciliation, canonical ontology mapping | Delivered actuals to calibrate against |
| 4 | Commons: secure aggregation, DP budget enforcement, cross-tenant benchmarks | A second real tenant |

The discipline that mattered throughout: nothing from Phase 4 gets built
until Phase 1 is proven on one tenant's real, ugly data. The schema carries
the shape for all four phases today; the *code* for phases 2-4 doesn't need
to exist yet, and building it early is the most likely way to waste the
solo-dev timeline established earlier.

---

## 4. Known simplifications, stated plainly

- **Event-sourcing-lite, not a full event store.** `allocations` and
  `rate_card_entries` are append-only via `superseded_at`, which gives
  point-in-time reconstruction without a generic replay engine. Revisit only
  if a real need for full event replay shows up.
- **RLS via join, not denormalized `tenant_id`.** `capabilities`/
  `allocations`/`effort_estimates` inherit tenant scope transitively through
  `bid_id` rather than carrying their own `tenant_id`. Simpler to keep
  correct; denormalize only if query planning on the join becomes a measured
  cost at real scale.
- **Pod/resource merge via `coalesce()` in rollup queries**, not a full
  polymorphic assignee abstraction. Fine until the UI needs to treat the two
  as meaningfully different objects rather than one label source.
- **COCOMO's `TOOL` driver has one unverified row** — flagged explicitly in
  `seed_data.sql`, not silently presented as complete.
- **DP is designed, not deployed.** Every table in 2.11 exists; no application
  code implementing the noise mechanism has been written, because there's no
  second tenant yet to protect.
