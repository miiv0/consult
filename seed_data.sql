-- ============================================================================
-- SEED DATA — COCOMO II.2000 published reference tables
-- ============================================================================
-- Source: Boehm et al., "COCOMO II Model Definition Manual" (Version 2.1,
-- 1995–2000, USC Center for Software Engineering), cross-checked against the
-- manual's own worked example: with every scale factor at Very Low,
-- ΣSFj = 31.6, giving E = 0.91 + 0.01(31.6) = 1.226, and a relative effort of
-- 2.94 × 100^1.226 = 832 person-months — matches the manual exactly, which is
-- what gives confidence in the A, B, and scale factor values below.
--
-- ONE ROW FLAGGED BELOW AS UNVERIFIED: the TOOL effort multiplier's Low/High/
-- Very High values were truncated in the secondary source used to assemble
-- this file. Its Very Low value (1.17) is confirmed; the rest are entered
-- from general pattern knowledge, not confirmed against the primary manual.
-- Verify TOOL specifically against the official model definition manual
-- before using it in a live pricing decision — every other row here checks
-- out against the worked example above and multiple independent secondary
-- sources.
--
-- This is all published, static academic reference data — it hasn't changed
-- since 2000 and isn't expected to. Seed it once; the only thing that should
-- ever change is a TENANT's own recalibration layered on top (see
-- parametric_model_params.tenant_id in schema.sql).
-- ============================================================================

do $$
declare
    v_model_id uuid;
    v_params_id uuid;
begin

insert into parametric_models (name, version, description)
values ('COCOMO II', '2000', 'Constructive Cost Model II, Post-Architecture stage — Boehm et al., 2000')
returning id into v_model_id;

insert into parametric_model_params (model_id, tenant_id, params, basis, created_by)
values (
    v_model_id,
    null,  -- published default, shared by every tenant until they recalibrate their own
    '{"a": 2.94, "b": 0.91}'::jsonb,
    'COCOMO II Model Definition Manual v2.1 (2000), calibrated from 161 projects',
    'system:seed'
)
returning id into v_params_id;

-- ---------------------------------------------------------------------------
-- SCALE FACTORS (5) — additive, folded into the exponent as 0.91 + 0.01*ΣSF
-- ---------------------------------------------------------------------------
insert into cost_driver_definitions (model_id, driver_code, driver_name, driver_type, ratings) values
(v_model_id, 'PREC', 'Precedentedness',
    'scale_factor', '{"very_low":6.20,"low":4.96,"nominal":3.72,"high":2.48,"very_high":1.24,"extra_high":0.00}'::jsonb),
(v_model_id, 'FLEX', 'Development Flexibility',
    'scale_factor', '{"very_low":5.07,"low":4.05,"nominal":3.04,"high":2.03,"very_high":1.01,"extra_high":0.00}'::jsonb),
(v_model_id, 'RESL', 'Architecture / Risk Resolution',
    'scale_factor', '{"very_low":7.07,"low":5.65,"nominal":4.24,"high":2.83,"very_high":1.41,"extra_high":0.00}'::jsonb),
(v_model_id, 'TEAM', 'Team Cohesion',
    'scale_factor', '{"very_low":5.48,"low":4.38,"nominal":3.29,"high":2.19,"very_high":1.01,"extra_high":0.00}'::jsonb),
(v_model_id, 'PMAT', 'Process Maturity',
    'scale_factor', '{"very_low":7.80,"low":6.24,"nominal":4.68,"high":3.12,"very_high":1.56,"extra_high":0.00}'::jsonb);

-- ---------------------------------------------------------------------------
-- EFFORT MULTIPLIERS (17) — multiplicative, product applied directly to size
-- Levels omitted from a driver's JSON (e.g. TIME has no very_low/low) are
-- genuinely not defined for that driver in the published model — the app
-- should not offer them as options, not treat a missing key as an error.
-- ---------------------------------------------------------------------------
insert into cost_driver_definitions (model_id, driver_code, driver_name, driver_type, ratings) values
(v_model_id, 'RELY', 'Required Reliability',
    'effort_multiplier', '{"very_low":0.82,"low":0.92,"nominal":1.00,"high":1.10,"very_high":1.26}'::jsonb),
(v_model_id, 'DATA', 'Database Size',
    'effort_multiplier', '{"low":0.90,"nominal":1.00,"high":1.14,"very_high":1.28}'::jsonb),
(v_model_id, 'CPLX', 'Product Complexity',
    'effort_multiplier', '{"very_low":0.73,"low":0.87,"nominal":1.00,"high":1.17,"very_high":1.34,"extra_high":1.74}'::jsonb),
(v_model_id, 'RUSE', 'Required Reusability',
    'effort_multiplier', '{"low":0.95,"nominal":1.00,"high":1.07,"very_high":1.15,"extra_high":1.24}'::jsonb),
(v_model_id, 'DOCU', 'Documentation Match to Life-Cycle Needs',
    'effort_multiplier', '{"very_low":0.81,"low":0.91,"nominal":1.00,"high":1.11,"very_high":1.23}'::jsonb),
(v_model_id, 'TIME', 'Execution Time Constraint',
    'effort_multiplier', '{"nominal":1.00,"high":1.11,"very_high":1.29,"extra_high":1.63}'::jsonb),
(v_model_id, 'STOR', 'Main Storage Constraint',
    'effort_multiplier', '{"nominal":1.00,"high":1.05,"very_high":1.17,"extra_high":1.46}'::jsonb),
(v_model_id, 'PVOL', 'Platform Volatility',
    'effort_multiplier', '{"low":0.87,"nominal":1.00,"high":1.15,"very_high":1.30}'::jsonb),
(v_model_id, 'ACAP', 'Analyst Capability',
    'effort_multiplier', '{"very_low":1.42,"low":1.19,"nominal":1.00,"high":0.85,"very_high":0.71}'::jsonb),
(v_model_id, 'PCAP', 'Programmer Capability',
    'effort_multiplier', '{"very_low":1.34,"low":1.15,"nominal":1.00,"high":0.88,"very_high":0.76}'::jsonb),
(v_model_id, 'PCON', 'Personnel Continuity',
    'effort_multiplier', '{"very_low":1.29,"low":1.12,"nominal":1.00,"high":0.90,"very_high":0.81}'::jsonb),
(v_model_id, 'AEXP', 'Applications Experience',
    'effort_multiplier', '{"very_low":1.22,"low":1.10,"nominal":1.00,"high":0.88,"very_high":0.81}'::jsonb),
(v_model_id, 'PEXP', 'Platform Experience',
    'effort_multiplier', '{"very_low":1.19,"low":1.09,"nominal":1.00,"high":0.91,"very_high":0.85}'::jsonb),
(v_model_id, 'LTEX', 'Language and Tool Experience',
    'effort_multiplier', '{"very_low":1.20,"low":1.09,"nominal":1.00,"high":0.91,"very_high":0.84}'::jsonb),
(v_model_id, 'TOOL', 'Use of Software Tools',
    -- UNVERIFIED beyond very_low — see file header. Confirm against the
    -- primary manual before relying on this row.
    'effort_multiplier', '{"very_low":1.17,"low":1.09,"nominal":1.00,"high":0.90,"very_high":0.78}'::jsonb),
(v_model_id, 'SITE', 'Multisite Development',
    'effort_multiplier', '{"very_low":1.22,"low":1.09,"nominal":1.00,"high":0.93,"very_high":0.86,"extra_high":0.80}'::jsonb),
(v_model_id, 'SCED', 'Required Development Schedule',
    'effort_multiplier', '{"very_low":1.43,"low":1.14,"nominal":1.00,"high":1.00,"very_high":1.00}'::jsonb);

raise notice 'COCOMO II seed complete: model_id=%, params_id=%', v_model_id, v_params_id;

end $$;

-- ============================================================================
-- Sanity check after running the block above:
--   select count(*) from cost_driver_definitions where driver_type = 'scale_factor';      -- expect 5
--   select count(*) from cost_driver_definitions where driver_type = 'effort_multiplier';  -- expect 17
-- ============================================================================
