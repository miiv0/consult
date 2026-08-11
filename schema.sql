-- ============================================================================
-- PURSUIT MODELING MVP — CORE SCHEMA
-- ============================================================================
-- Grounded directly in this week's exercise: Ph0 - MPX+.com AFOP payments
-- build. Every example below references real values from that model, so you
-- can sanity-check the schema against a case you already know cold.
--
-- Design principles this schema encodes (from the architecture conversation):
--   1. One allocation grain. Every rollup (pod, role area, location, phase)
--      is a GROUP BY over `allocations`, never a separately-maintained table.
--   2. Append-only where it matters. Rate cards and allocations are versioned
--      (superseded_at), not overwritten — so a submitted bid's economics
--      never silently change under it.
--   3. Governance/contingency is a first-class allocation, not an additive
--      formula bolted onto pod totals. This is the bug that cost $503K by
--      hand this week; the schema makes it structurally impossible to repeat.
--   4. Cost and fees are resolved and stored AT THE GRAIN, not recomputed at
--      render time from a live rate lookup — so a rate card update never
--      rewrites a bid you already submitted.
--   5. Assignment doesn't require a pod. Most hours route through a pod
--      roster, but `allocations` can resolve to a standalone `resource`
--      instead — a named specialist or client-side SME with no pod at all.
--      Exactly one of pod_id / resource_id is set, enforced by a CHECK
--      constraint, not a convention.
--   6. Effort estimation is its own entity, not a column. `effort_estimates`
--      sits between `capabilities` and `allocations` so a capability can
--      carry a bottom-up estimate AND a parametric estimate side by side for
--      reconciliation, with exactly one flagged `is_selected` as the number
--      that actually feeds allocations.
--   7. Client-specific vocabulary is data, not schema. Role areas, location
--      buckets, and rate card dimensions are tenant-scoped lookup tables,
--      never CHECK constraints or fixed columns — because the six role
--      areas and four location buckets baked into earlier drafts of this
--      schema are THIS engagement's categories, not a universal truth. The
--      next client's shape is different, and shouldn't require a migration.
--
-- Honest simplification for solo-dev MVP pace: this is "event-sourcing-lite,"
-- not a full event store. Business tables (allocations, rate_card_entries,
-- effort_estimates) are themselves append-only/versioned via superseded_at,
-- which gives you point-in-time reconstruction without needing a generic
-- event-replay engine. `ledger_events` below is a lightweight audit trail on
-- top of that, not the source of truth. Revisit if/when you need true event
-- replay.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- TENANTS — one row per client firm
-- ----------------------------------------------------------------------------
-- Every operational table below (rate_cards, pods, resources, bids, and
-- everything hanging off a bid) is tenant-scoped. Enforce isolation with
-- Postgres row-level security keyed on tenant_id — see the example policy
-- near the end of this file — rather than trusting every query to remember
-- a WHERE clause.

create table tenants (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,               -- e.g. the consulting firm's name
    created_at      timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- CANONICAL CONCEPTS — the one deliberately GLOBAL, non-tenant table
-- ----------------------------------------------------------------------------
-- This is the shared vocabulary from the ontology conversation: a small,
-- platform-owned set of concepts (anchored to something like ISBSG/SPI
-- categories) that tenant-local taxonomies can OPTIONALLY map onto. A firm
-- that calls its category 'Build' and a firm that calls its category
-- 'Development' can both point at the same canonical_concept row without
-- either firm's local vocabulary having to change. Mapping is opt-in — a
-- tenant that never sets canonical_concept_id simply doesn't participate in
-- cross-tenant benchmarking on that dimension, which is fine.

create table canonical_concepts (
    id              uuid primary key default gen_random_uuid(),
    concept_type    text not null check (concept_type in (
                        'role_area', 'location_tier', 'capability_class'
                    )),
    name            text not null,               -- e.g. 'Development' (canonical, ISBSG-anchored)
    description     text,
    -- DP release configuration for cross-tenant benchmarking on this concept.
    -- Bucket edges are FIXED here, platform-wide, deliberately not tenant-
    -- configurable — a tenant choosing its own bucket boundaries would be a
    -- side channel (bucket edges tuned around one firm's known value leak
    -- information the buckets are supposed to hide).
    dp_bucket_edges     jsonb,                    -- e.g. [50,100,200,500,1000] hour boundaries
    dp_epsilon_per_query numeric not null default 0.1,  -- privacy cost of a single benchmark query
    dp_min_tenants      integer not null default 5,      -- benchmark refuses to run below this —
                                                            --   defense in depth alongside noise
    unique (concept_type, name)
);


-- ----------------------------------------------------------------------------
-- PRIVACY BUDGETS — the enforcement mechanism DP actually depends on
-- ----------------------------------------------------------------------------
-- Noise alone doesn't protect anyone against a determined, repeated querier —
-- run the same benchmark enough times and the noise averages out. This is
-- what makes that attack cost something: every benchmark query against a
-- canonical concept deducts from the QUERYING tenant's budget for that
-- concept, and once it's spent, that tenant can't pull that benchmark again
-- until the period resets. Enforced at the query path, not trusted to the UI.

create table privacy_budgets (
    id                      uuid primary key default gen_random_uuid(),
    tenant_id               uuid not null references tenants(id),   -- the tenant SPENDING budget
    canonical_concept_id    uuid not null references canonical_concepts(id),
    epsilon_limit           numeric not null default 1.0,
    epsilon_spent           numeric not null default 0,
    period_start            date not null,
    period_end              date not null,
    unique (tenant_id, canonical_concept_id, period_start)
);

-- Every benchmark query, successful or refused, gets logged — the audit
-- trail that makes "why was this query blocked" and "who queried this
-- concept before the anomaly we noticed" both answerable.
create table benchmark_query_log (
    id                      uuid primary key default gen_random_uuid(),
    tenant_id               uuid not null references tenants(id),
    canonical_concept_id    uuid not null references canonical_concepts(id),
    tenant_count_in_result  integer,                 -- null if refused before counting
    epsilon_charged         numeric,
    outcome                 text not null check (outcome in ('served', 'refused_min_n', 'refused_budget')),
    created_at              timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ROLE AREAS — tenant-scoped, replaces the hardcoded CHECK constraint
-- ----------------------------------------------------------------------------
-- e.g. this engagement's six categories (Development, Testing, Requirements
-- Analysis, Deployment & Infrastructure, Design, Program Governance) are one
-- tenant's row set here, not a schema-wide enum. A different client might
-- run four categories with different names entirely.

create table role_areas (
    id                      uuid primary key default gen_random_uuid(),
    tenant_id               uuid not null references tenants(id),
    name                    text not null,                          -- e.g. 'Development', or a
                                                                       --   client's own label
    canonical_concept_id    uuid references canonical_concepts(id),  -- optional cross-tenant mapping
    unique (tenant_id, name)
);


-- ----------------------------------------------------------------------------
-- LOCATION BUCKETS — tenant-scoped, replaces raw 'PMD'/'DIR'/'US'/'AC' text
-- ----------------------------------------------------------------------------
-- This engagement's four buckets are one tenant's configuration. A firm with
-- a different staffing model (say, three tiers instead of four, or an
-- onshore/nearshore/offshore split) configures its own rows here — the
-- pod/role mechanics downstream don't change.

create table location_buckets (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    code            text not null,               -- e.g. 'PMD', 'AC' — short form used in rosters
    label           text not null,               -- e.g. 'Program/Managing Director'
    unique (tenant_id, code)
);


-- ----------------------------------------------------------------------------
-- RATE CARDS — versioned object, never a live lookup table
-- ----------------------------------------------------------------------------
-- Descriptive dimensions (LOS, staff class, experience level, whatever a
-- given firm's rate card is organized by) live in `dimensions` as JSONB
-- rather than fixed columns — see rate_card_entries below. Different firms
-- structure rate cards along genuinely different axes; the only universal
-- truths are "there's a lookup key" and "it resolves to a bill rate and a
-- cost."

create table rate_cards (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    name            text not null,                    -- e.g. 'FY26 Standard Rate Card'
    version         integer not null,                  -- increments per firm, never reused
    status          text not null default 'draft'      -- draft | active | superseded
                        check (status in ('draft', 'active', 'superseded')),
    effective_date  date not null,
    superseded_at   timestamptz,                        -- null = current
    created_by      text not null,
    created_at      timestamptz not null default now(),
    unique (tenant_id, name, version)
);

-- One row per resolvable rate. `dimensions` holds whatever descriptive axes
-- this tenant's rate card actually uses — e.g. this engagement's
-- {"los": "Advisory", "staff_class": "Director", "experience_level": "Cohort 3"}
-- — as freeform JSONB rather than fixed columns, because a different tenant
-- might organize by {"practice": "...", "band": "..."} instead and shouldn't
-- need a schema change to onboard. `rate_key` is the one universal
-- requirement: a resolvable lookup string every pod_roles/resources row
-- resolves against, however this tenant's dimensions compose it.
create table rate_card_entries (
    id              uuid primary key default gen_random_uuid(),
    rate_card_id    uuid not null references rate_cards(id),
    rate_key        text not null,               -- e.g. 'US_Director_Cohort 3' for this tenant;
                                                    --   any composite key another tenant prefers
    dimensions      jsonb not null default '{}',   -- e.g. {"los":"Advisory","staff_class":"Director",
                                                    --       "experience_level":"Cohort 3"}
    target_rate     numeric(10,2) not null,        -- bill rate, e.g. 645.00
    rsr_cost        numeric(10,2) not null,         -- resource cost, e.g. 499.00
    unique (rate_card_id, rate_key)
);

create index idx_rate_card_entries_lookup
    on rate_card_entries (rate_card_id, rate_key);
create index idx_rate_card_entries_dimensions
    on rate_card_entries using gin (dimensions);


-- ----------------------------------------------------------------------------
-- PODS — delivery teams, e.g. 'Integration Pod', 'PCP Data Pod', 'Program Pod'
-- ----------------------------------------------------------------------------

create table pods (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    name            text not null,                       -- e.g. 'Integration Pod'
    description     text,
    is_delivery_pod boolean not null default true,       -- false for Program Pod / overhead pools
    metadata        jsonb not null default '{}',          -- escape valve for anything tenant-specific
                                                            --   that doesn't warrant its own column
    unique (tenant_id, name)
);

-- Per-pod sprint parameters — e.g. Design Pod: PMD=8hrs/day, DIR=20, US=16, AC=18,
-- sprint=10 days. Each pod's roster hours are derived from these.
create table pod_parameters (
    id                  uuid primary key default gen_random_uuid(),
    pod_id              uuid not null references pods(id),
    location_bucket_id  uuid not null references location_buckets(id),
    hrs_per_day         numeric(6,2) not null,
    sprint_days         integer not null default 10,
    unique (pod_id, location_bucket_id)
);

-- The roster template — one row per role-in-pod, e.g. Integration Pod's
-- 'Backend Engineer' (AC, 90 hrs/sprint) or Program Pod's 'Program Lead'
-- (PMD, 8 hrs/sprint, rate-carded against 'US_Director_Cohort 3').
create table pod_roles (
    id                  uuid primary key default gen_random_uuid(),
    pod_id              uuid not null references pods(id),
    role_name           text not null,                    -- e.g. 'Program Lead', 'SDET'
    location_bucket_id  uuid not null references location_buckets(id),
    rate_key            text not null,                    -- resolves against rate_card_entries
    role_area_id        uuid not null references role_areas(id),
    loading_pct         numeric(5,4) not null,             -- e.g. 0.125
    hrs_per_sprint      numeric(8,2) not null              -- resolved: hrs_per_day * sprint_days
);                                                           --   * loading_pct (computed in app,
                                                              --   stored here for the grain to read)


-- ----------------------------------------------------------------------------
-- RESOURCES — capacity assigned WITHOUT going through a pod
-- ----------------------------------------------------------------------------
-- Not every hour on a bid comes from a pod roster. A named specialist pulled
-- in for a slice of advisory work, a client-side SME, an independent
-- contractor for one capability — these need to be assignable directly,
-- without inventing a one-person "pod" to hold them.
--
-- Same rate-card lookup mechanism as pod_roles (rate_key against
-- rate_card_entries), and the same optional hrs_per_sprint so "sprints
-- needed" math works identically whether the assignee is a pod or a lone
-- resource.

create table resources (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id),
    name                text not null,                -- e.g. 'Jane Doe, Principal Architect'
                                                        --   or a generic label like
                                                        --   'Independent SME - Fraud Advisory'
    rate_key            text not null,                -- resolves against rate_card_entries
    role_area_id        uuid not null references role_areas(id),
    hrs_per_sprint      numeric(8,2),                  -- optional; needed only if you want
                                                        --   sprints-needed math for this
                                                        --   resource the way pods get it
    is_reusable         boolean not null default true, -- false = one-off, created inline
                                                        --   for a single bid, never reused
    metadata            jsonb not null default '{}'     -- escape valve, e.g. certifications,
                                                        --   security clearance — whatever this
                                                        --   tenant needs that isn't universal
);


-- ----------------------------------------------------------------------------
-- BIDS — the top-level pursuit object
-- ----------------------------------------------------------------------------

create table bids (
    id                   uuid primary key default gen_random_uuid(),
    tenant_id            uuid not null references tenants(id),
    name                 text not null,                  -- e.g. 'Ph0 - MPX+.com AFOP'
    client_name          text,
    status               text not null default 'draft'
        check (status in ('draft', 'under_review', 'approved', 'client_ready', 'won', 'lost')),
    rate_card_id         uuid not null references rate_cards(id),  -- frozen at bid creation
    governance_carveout_pct numeric(5,4) not null default 0.08,    -- the "8%" — a bid-level
                                                                     -- parameter, never hardcoded
    target_price         numeric(14,2),                   -- e.g. 1,700,000.00
    target_margin        numeric(5,4),                    -- e.g. 0.20
    created_by           text not null,
    created_at           timestamptz not null default now(),
    submitted_at         timestamptz,
    submitted_snapshot_id uuid                             -- set on submit; see bid_snapshots
);


-- ----------------------------------------------------------------------------
-- CAPABILITIES — pure scope metadata, no hours. Effort lives in
-- effort_estimates below, deliberately kept separate.
-- ----------------------------------------------------------------------------
-- e.g. 'Integration - Payment primary flow - Deuna', domain 'Integration',
-- in_scope true, size 'Medium'/'Low'. tenant_id is intentionally NOT
-- duplicated here — capabilities inherit tenant scope transitively via
-- bid_id. See the RLS note near the end of this file for the tradeoff
-- between join-based scoping (used here) and denormalizing tenant_id onto
-- every child table for policy performance.

create table capabilities (
    id              uuid primary key default gen_random_uuid(),
    bid_id          uuid not null references bids(id),
    domain          text,                                -- e.g. 'Integration'
    use_case        text,
    name            text not null,                        -- e.g. 'Canonicalization - Data model'
    in_scope        boolean not null default true,
    build_type      text,
    size_band       text,                                 -- Extra Low | Low | Medium | High
    metadata        jsonb not null default '{}'            -- escape valve for tenant-specific
                                                             --   capability attributes
);


-- ----------------------------------------------------------------------------
-- EFFORT ESTIMATES — where the actual effort-sizing work happens
-- ----------------------------------------------------------------------------
-- This is the answer to "where is efforting": it's its own entity, not a
-- column on capabilities, because a capability can carry MULTIPLE estimates
-- at once — a bottom-up number and a parametric number, shown side by side
-- for reconciliation (the "run both, show the delta" design from a few turns
-- back). Exactly one is flagged is_selected — that's the one allocations
-- actually consume. Versioned via superseded_at, same discipline as
-- allocations and rate cards: re-estimating never overwrites history.

create table effort_estimates (
    id              uuid primary key default gen_random_uuid(),
    capability_id   uuid not null references capabilities(id),
    method          text not null check (method in ('bottom_up', 'parametric', 'analogy')),
    hours_low       numeric(10,2),                         -- three-point: optimistic
    hours_likely    numeric(10,2) not null,                -- feeds Monte Carlo contingency (Phase 2)
    hours_high      numeric(10,2),                         -- three-point: pessimistic
    basis           text,                                  -- e.g. 'SUMIF vs backlog effort sheet'
                                                              --   or 'COCOMO II, 12,000 SLOC, nominal'
    is_selected     boolean not null default false,         -- true = this estimate feeds allocations
    created_by      text not null,
    created_at      timestamptz not null default now(),
    superseded_at   timestamptz
);

-- Exactly one active, selected estimate per capability at any time.
create unique index idx_one_selected_estimate_per_capability
    on effort_estimates (capability_id)
    where is_selected and superseded_at is null;


-- ----------------------------------------------------------------------------
-- ALLOCATIONS — the grain. Every rollup in the product is a GROUP BY on this.
-- ----------------------------------------------------------------------------
-- Two independent dimensions:
--
--   WHO does the work — exactly one of pod_id / resource_id is set, never
--   both, never neither. Most hours route through a pod roster, but not all
--   effort has to: a named specialist or a client-side SME is a resource_id
--   row with no pod at all. The CHECK constraint makes "pod-less assignment"
--   a real, supported path rather than something you'd fake with a
--   one-person pod.
--
--   WHAT KIND of row it is —
--     'direct'              — a capability's hours assigned to a pod or a
--                              resource, e.g. 'Integration - Payment primary
--                              flow - Deuna' split 60% Integration Pod /
--                              40% PCP Pod - Orchestrator => two direct rows.
--     'governance_carveout' — auto-derived from each direct row: pct% of that
--                              row's hours, routed to the Program Pod, with
--                              parent_allocation_id pointing back to the
--                              direct row it was carved from. Structural,
--                              not an Excel formula someone can flip to
--                              "additive."
--
-- Versioned via superseded_at rather than UPDATE, so a bid's history of edits
-- (including agent-proposed ops) is fully reconstructable.

create table allocations (
    id                      uuid primary key default gen_random_uuid(),
    bid_id                  uuid not null references bids(id),
    capability_id           uuid not null references capabilities(id),
    pod_id                  uuid references pods(id),          -- one of pod_id / resource_id
    resource_id             uuid references resources(id),     --   is set, never both
    kind                    text not null check (kind in ('direct', 'governance_carveout')),
    parent_allocation_id    uuid references allocations(id),  -- set only when kind = 'governance_carveout'
    allocation_pct          numeric(6,4) not null,             -- e.g. 0.60 for the Deuna/Integration split
    resolved_hours          numeric(12,2) not null,            -- selected effort_estimate.hours_likely
                                                                 --   * allocation_pct
    resolved_rate_per_hr    numeric(10,4) not null,             -- pod's blended rate, or the resource's
    resolved_cost_per_hr    numeric(10,4) not null,             --   own rate-card lookup — AT TIME OF WRITE
    resolved_fees           numeric(14,2) not null,             -- resolved_hours * resolved_rate_per_hr
    resolved_cost           numeric(14,2) not null,             -- resolved_hours * resolved_cost_per_hr
    created_by              text not null,                      -- 'user:<id>' or 'agent:<op_id>'
    created_at              timestamptz not null default now(),
    superseded_at           timestamptz,                        -- null = currently active row
    constraint chk_exactly_one_assignee check (
        (pod_id is not null and resource_id is null) or
        (pod_id is null and resource_id is not null)
    )
);

create index idx_allocations_active_pod
    on allocations (bid_id, pod_id) where superseded_at is null;
create index idx_allocations_active_resource
    on allocations (bid_id, resource_id) where superseded_at is null;
create index idx_allocations_by_capability
    on allocations (capability_id) where superseded_at is null;


-- ----------------------------------------------------------------------------
-- BID SNAPSHOTS — frozen state on submit
-- ----------------------------------------------------------------------------
-- The full resolved allocation set at the moment of submission, immutable.
-- Reprice-on-new-card and win/loss analysis both read from here, never from
-- the live (and possibly since-edited) allocations table.

create table bid_snapshots (
    id              uuid primary key default gen_random_uuid(),
    bid_id          uuid not null references bids(id),
    rate_card_id    uuid not null references rate_cards(id),
    snapshot        jsonb not null,        -- full resolved allocation rows at submit time
    total_hours     numeric(12,2) not null,
    total_fees      numeric(14,2) not null,
    total_cost      numeric(14,2) not null,
    margin_pct      numeric(6,4) not null,
    created_at      timestamptz not null default now()
);

alter table bids
    add constraint fk_submitted_snapshot
    foreign key (submitted_snapshot_id) references bid_snapshots(id);


-- ----------------------------------------------------------------------------
-- FLAGS — deterministic rule-engine output (see the flagging design)
-- ----------------------------------------------------------------------------

create table flags (
    id                  uuid primary key default gen_random_uuid(),
    bid_id              uuid not null references bids(id),
    rule_code           text not null,          -- e.g. 'MARGIN_BELOW_FLOOR', 'RATE_CONCENTRATION',
                                                  --      'SINGLE_THREAD_DURATION_OUTLIER'
    severity            text not null check (severity in ('block', 'warn', 'info')),
    message             text not null,           -- plain language, names the driver
    suggested_action    text,                    -- e.g. 'run_solver'
    status              text not null default 'open'
        check (status in ('open', 'acknowledged', 'resolved')),
    acknowledged_by     text,
    acknowledged_note   text,
    created_at          timestamptz not null default now(),
    resolved_at         timestamptz
);


-- ----------------------------------------------------------------------------
-- LEDGER EVENTS — lightweight audit trail (not the source of truth — see note
-- at top of file)
-- ----------------------------------------------------------------------------

create table ledger_events (
    id              uuid primary key default gen_random_uuid(),
    bid_id          uuid not null references bids(id),
    event_type      text not null,              -- e.g. 'allocation_changed', 'target_set',
                                                  --      'bid_submitted', 'flag_acknowledged'
    actor           text not null,               -- 'user:<id>' or 'agent:<op_id>'
    payload         jsonb not null,              -- structured op, e.g.
                                                  -- {"op":"reallocate","capability":"...",
                                                  --  "from_pod":"Design Pod","to_pod":"Integration Pod",
                                                  --  "pct":1.0}
    created_at      timestamptz not null default now()
);

create index idx_ledger_events_by_bid on ledger_events (bid_id, created_at);


-- ============================================================================
-- EXAMPLE ROLLUP QUERIES — proof that every view is a GROUP BY, not a table
-- ============================================================================

-- Assignee rollup: effort hours needed per pod OR standalone resource, this
-- week's "Pod Rollup - Phase 0" table, generalized to cover both assignment
-- paths. coalesce() is the one place the two dimensions merge into a single
-- "who's doing this work" label — deliberately simple over a full polymorphic
-- abstraction, appropriate at MVP scale; revisit if the coalesce ever feels
-- like it's hiding a real distinction the UI needs to preserve.
-- select coalesce(p.name, r.name) as assignee,
--        (p.id is not null)       as is_pod,
--        sum(a.resolved_hours) as effort_hours_needed,
--        sum(a.resolved_fees)  as total_fees_needed,
--        sum(a.resolved_cost)  as total_cost_needed,
--        (sum(a.resolved_fees) - sum(a.resolved_cost)) / nullif(sum(a.resolved_fees), 0) as margin_pct
-- from allocations a
-- left join pods p on p.id = a.pod_id
-- left join resources r on r.id = a.resource_id
-- where a.bid_id = :bid_id and a.superseded_at is null
-- group by coalesce(p.name, r.name), (p.id is not null);

-- Role area rollup: this week's "Effort by Role Area" table — same grain,
-- role_area now resolved through the tenant's own role_areas rows rather
-- than a hardcoded list, so this query is identical for every tenant
-- regardless of how many categories they run or what they call them.
-- select coalesce(ra_pod.name, ra_res.name) as role_area,
--        sum(a.resolved_hours) as total_hours_needed
-- from allocations a
-- left join pod_roles pr on pr.pod_id = a.pod_id       -- again, in practice join via the
-- left join role_areas ra_pod on ra_pod.id = pr.role_area_id  --   specific role assigned, not
-- left join resources r on r.id = a.resource_id          --   just the pod
-- left join role_areas ra_res on ra_res.id = r.role_area_id
-- where a.bid_id = :bid_id and a.superseded_at is null
-- group by coalesce(ra_pod.name, ra_res.name)
-- order by total_hours_needed desc;

-- Governance carve-out trace: which capabilities fed the Program Pod, and
-- from which pod OR resource each carve-out was actually cut.
-- select c.name as capability,
--        coalesce(p_from.name, r_from.name) as carved_from,
--        a.resolved_hours
-- from allocations a
-- join allocations parent on parent.id = a.parent_allocation_id
-- left join pods p_from on p_from.id = parent.pod_id
-- left join resources r_from on r_from.id = parent.resource_id
-- join capabilities c on c.id = a.capability_id
-- where a.kind = 'governance_carveout' and a.bid_id = :bid_id and a.superseded_at is null;

-- Cross-tenant benchmark, DP-CORRECT VERSION — this replaces the naive
-- percentile_cont() query from an earlier draft, which returned an
-- unprotected raw percentile with no noise, no minimum group size, and no
-- budget accounting. That version should never run against real data.
--
-- Step 1 (SQL): a noisy-count HISTOGRAM, not a noisy percentile. Bucketing
-- first is what makes Laplace noise valid here — COUNT has clean, bounded
-- sensitivity (one tenant's data changes a bucket's count by a small, known
-- amount); a raw percentile does not, since one outlier tenant can shift a
-- median arbitrarily in a small sample. Gated by dp_min_tenants BEFORE
-- returning anything, and by the querying tenant's remaining budget.
--
-- select width_bucket(a.resolved_hours, edges.lo, edges.hi, edges.n) as bucket,
--        count(distinct a.bid_id) as tenant_count,   -- checked against dp_min_tenants below
--        count(*) as raw_count                        -- noise added to THIS in application code,
-- from allocations a                                   --   never returned un-noised
-- join pod_roles pr on pr.pod_id = a.pod_id
-- join role_areas ra on ra.id = pr.role_area_id
-- join canonical_concepts cc on cc.id = ra.canonical_concept_id
-- cross join lateral (select 0 as lo, 2000 as hi, 20 as n) edges
-- where cc.concept_type = 'role_area' and cc.name = :canonical_name and a.superseded_at is null
-- group by bucket
-- having count(distinct a.bid_id) >= (select dp_min_tenants from canonical_concepts where name = :canonical_name);
--
-- Step 2 (application code, not SQL): for each bucket's raw_count, sample
-- Laplace(scale = 1/epsilon) and add it to the count, clamping negative
-- results to zero. Deduct cc.dp_epsilon_per_query from the querying tenant's
-- privacy_budgets row for this concept — refuse the query entirely if that
-- would exceed epsilon_limit for the period, and log the outcome to
-- benchmark_query_log either way (served, refused_min_n, or refused_budget).
--
-- Step 3 (application code): reconstruct P50/P80 from the NOISED bucket
-- counts (cumulative sum across buckets until crossing 50%/80% of noised
-- total) rather than from the underlying rows. The percentile the caller
-- sees is a property of the protected histogram, never of raw data.

-- Gate check — run BEFORE the histogram query above, not after:
-- select (epsilon_limit - epsilon_spent) >= cc.dp_epsilon_per_query as has_budget
-- from privacy_budgets pb
-- join canonical_concepts cc on cc.id = pb.canonical_concept_id
-- where pb.tenant_id = :querying_tenant_id
--   and pb.canonical_concept_id = (select id from canonical_concepts where name = :canonical_name)
--   and current_date between pb.period_start and pb.period_end;
-- If this returns false or no row, refuse and log outcome = 'refused_budget'
-- without running the histogram query at all — the point of gating first is
-- that a refused query costs nothing, so probing for the gate itself leaks
-- no information about the underlying data.

-- Estimate reconciliation: bottom-up vs parametric side by side, per
-- capability — the "run both, show the delta" check from the parametric
-- sizing discussion. Large divergence is the signal to investigate before
-- submitting, not after.
-- select c.name as capability,
--        max(e.hours_likely) filter (where e.method = 'bottom_up')  as bottom_up_hours,
--        max(e.hours_likely) filter (where e.method = 'parametric') as parametric_hours,
--        abs(max(e.hours_likely) filter (where e.method = 'bottom_up')
--            - max(e.hours_likely) filter (where e.method = 'parametric'))
--          / nullif(max(e.hours_likely) filter (where e.method = 'bottom_up'), 0) as pct_divergence
-- from capabilities c
-- join effort_estimates e on e.capability_id = c.id and e.superseded_at is null
-- where c.bid_id = :bid_id
-- group by c.id, c.name
-- having count(distinct e.method) > 1;


-- ----------------------------------------------------------------------------
-- SIMULATION — Monte Carlo, run against effort_estimates, not stored per-draw
-- ----------------------------------------------------------------------------
-- This is a parallel analysis pass, not a pricing step. `allocations` and
-- everything downstream of it use `hours_likely` — a point value. Monte Carlo
-- is the only consumer of `hours_low`/`hours_high`: each run samples a
-- distribution per capability (triangular, off low/likely/high), applies that
-- capability's EXISTING allocation splits and pod/resource rates, and sums to
-- one iteration's total price. Only the resulting percentiles are persisted —
-- 10,000 raw draws would be pure noise to store and cost nothing to
-- regenerate if you ever need them again.
--
-- The reason this can't be "just sum each capability's P80": uncertainty
-- partially cancels across independent capabilities, so the sum's relative
-- spread is narrower than any single line item's. Summing P80s overstates
-- risk and pads the price. That's the whole justification for simulating
-- rather than eyeballing a flat contingency percentage.

create table simulation_runs (
    id              uuid primary key default gen_random_uuid(),
    bid_id          uuid not null references bids(id),
    iterations      integer not null default 10000,
    distribution    text not null default 'triangular'
                        check (distribution in ('triangular', 'pert')),
    random_seed     bigint,                       -- set for reproducibility, e.g. re-running
                                                     --   the same bid for a demo or an audit
    created_by      text not null,
    created_at      timestamptz not null default now()
);

-- One row per scope the results are broken out at — bid total, a single pod,
-- or a single capability — so the same run can back a partner's one-line
-- risk band AND a deal desk's pod-level breakdown without re-simulating.
create table simulation_results (
    id                  uuid primary key default gen_random_uuid(),
    simulation_run_id   uuid not null references simulation_runs(id),
    scope               text not null check (scope in ('bid_total', 'pod', 'capability')),
    scope_ref_id        uuid,                     -- pod_id or capability_id; null when scope = 'bid_total'
    p10_hours           numeric(12,2),
    p50_hours           numeric(12,2) not null,
    p80_hours           numeric(12,2) not null,
    p90_hours           numeric(12,2),
    p50_fees            numeric(14,2) not null,
    p80_fees            numeric(14,2) not null,     -- P80 fees minus P50 fees = the recommended
    p90_fees             numeric(14,2)               --   contingency reserve — a pricing number,
);                                                     --   never a staffed allocation


-- ============================================================================
-- ROW-LEVEL SECURITY — tenant isolation, enforced in Postgres, not in app code
-- ============================================================================
-- Example for a directly tenant-scoped table (bids). The Supabase/Postgres
-- convention: a JWT claim carries the caller's tenant_id, and the policy
-- checks every row against it. No query anywhere in the app can accidentally
-- return another tenant's rows, even a buggy one.
--
-- alter table bids enable row level security;
-- create policy tenant_isolation_bids on bids
--   using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
--
-- Child tables scoped transitively (capabilities, allocations,
-- effort_estimates) enforce the same isolation via a join back to bids:
--
-- alter table capabilities enable row level security;
-- create policy tenant_isolation_capabilities on capabilities
--   using (bid_id in (select id from bids where tenant_id = (auth.jwt() ->> 'tenant_id')::uuid));
--
-- The join-based policy is simpler to keep correct (one tenant_id column to
-- ever worry about, on bids). If query planning on the join ever shows up as
-- a real cost at scale, the standard fix is denormalizing tenant_id directly
-- onto capabilities/allocations/effort_estimates (maintained by a trigger on
-- insert) purely as a performance optimization — not a schema redesign.


-- ============================================================================
-- PARAMETRIC REFERENCE DATA — how COCOMO (or any parametric model) plugs in
-- ============================================================================
-- This is what makes effort_estimates.method = 'parametric' computable rather
-- than aspirational. Three pieces:
--
--   parametric_models / parametric_model_params — the model's calibration
--   constants. JSONB, not fixed columns, because COCOMO II's shape (A, B,
--   17 effort multipliers) looks nothing like SLIM's or a homegrown
--   regression's — this is the same "dimensions as data, not schema" move
--   made for rate cards a few tables back. tenant_id is nullable: a null-
--   tenant row is the published default (seeded once from the COCOMO II
--   manual); a tenant-specific row is that firm's own recalibration against
--   its delivered actuals, versioned via superseded_at like everything else.
--   Resolution order in the app: prefer the tenant's own row if one exists
--   and is current, fall back to the published default.
--
--   cost_driver_definitions — the published rating tables (e.g. COCOMO II's
--   RELY, CPLX, TEAM multipliers, each Very Low..Extra High). Deliberately
--   global, no tenant_id, same treatment as canonical_concepts: this is
--   published, shared reference data, not something each firm reinvents.
--
--   capability_parametric_inputs — the per-capability audit trail: what size
--   was used, which rating was picked for each driver, and what the
--   resulting effort_estimates row was computed from. This is what
--   effort_estimates.basis is pointing at when method = 'parametric'.

create table parametric_models (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,               -- e.g. 'COCOMO II', 'SLIM', 'In-house v2'
    version         text,                          -- e.g. '2000'
    description     text,
    unique (name, version)
);

create table parametric_model_params (
    id              uuid primary key default gen_random_uuid(),
    model_id        uuid not null references parametric_models(id),
    tenant_id       uuid references tenants(id),   -- null = published default, shared by all tenants
    params          jsonb not null,                -- e.g. {"a": 2.94, "b_nominal": 1.0997} for COCOMO II
    basis           text,                          -- e.g. 'COCOMO II model definition manual, 2000'
                                                     --   or 'recalibrated against 14 delivered projects'
    created_by      text not null,
    created_at      timestamptz not null default now(),
    superseded_at   timestamptz
);

-- Global, published rating tables — seeded once, shared across every tenant.
-- driver_type matters because the two kinds combine completely differently
-- in COCOMO's formula: effort multipliers (EM) are multiplied together
-- directly; scale factors (SF) are summed and folded into the exponent as
-- 0.91 + 0.01*ΣSF. Caught this distinction while assembling the actual seed
-- data below — the table as first drafted had no way to tell the app which
-- arithmetic to apply to a given row.
create table cost_driver_definitions (
    id              uuid primary key default gen_random_uuid(),
    model_id        uuid not null references parametric_models(id),
    driver_code     text not null,                 -- e.g. 'RELY', 'CPLX', 'PREC'
    driver_name     text not null,                 -- e.g. 'Required Reliability'
    driver_type     text not null check (driver_type in ('effort_multiplier', 'scale_factor')),
    ratings         jsonb not null,                 -- e.g. {"very_low":0.82,"low":0.92,"nominal":1.0,
                                                     --       "high":1.10,"very_high":1.26}
    unique (model_id, driver_code)
);

create index idx_cost_driver_definitions_type
    on cost_driver_definitions (model_id, driver_type);

-- The audit trail: exactly what a parametric effort_estimates row was
-- computed from, so "why does this capability say 1,340 hours" has a real
-- answer instead of a black box.
create table capability_parametric_inputs (
    id                      uuid primary key default gen_random_uuid(),
    capability_id           uuid not null references capabilities(id),
    model_params_id         uuid not null references parametric_model_params(id),
    size_value              numeric(12,2) not null,   -- e.g. 12000
    size_unit               text not null              -- SLOC | function_points | story_points —
        check (size_unit in ('sloc', 'function_points', 'story_points')),
    driver_ratings          jsonb not null default '{}', -- e.g. {"RELY":"high","CPLX":"nominal"}
    computed_effort_hours   numeric(10,2) not null,     -- the result actually written into
    created_at              timestamptz not null default now()  --   effort_estimates.hours_likely
);

-- Reconciliation, extended: same query as before, now with the parametric
-- side's basis visible for review when the two methods disagree.
-- select c.name as capability,
--        max(e.hours_likely) filter (where e.method = 'bottom_up')  as bottom_up_hours,
--        max(e.hours_likely) filter (where e.method = 'parametric') as parametric_hours,
--        max(cpi.size_value) filter (where e.method = 'parametric') as parametric_size,
--        max(cpi.size_unit)  filter (where e.method = 'parametric') as parametric_size_unit
-- from capabilities c
-- join effort_estimates e on e.capability_id = c.id and e.superseded_at is null
-- left join capability_parametric_inputs cpi
--   on cpi.capability_id = c.id and e.method = 'parametric'
-- where c.bid_id = :bid_id
-- group by c.id, c.name
-- having count(distinct e.method) > 1;
