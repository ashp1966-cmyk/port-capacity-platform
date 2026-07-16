-- lib/seed/demo_seed.sql
-- Synthetic demo data — NOT the Goa/MPT data, per the confirmed scope
-- decision (structure only). Everything here is fictional: port name,
-- vessel names, and volumes are invented but shaped realistically
-- (commodity mix, seasonal pattern) so dashboards render sensibly on a
-- fresh install. Safe to run once against an empty schema; re-running
-- will violate the unique constraints (by design — it's a seed, not a sync).

-- Statements run individually (no begin/commit wrapper) so a failure in
-- one block never silently rolls back everything that succeeded before
-- it — you can see and fix each statement independently.

-- ---- Port + berths ---------------------------------------------------
insert into ports (id, code, name, country, timezone) values
  ('00000000-0000-0000-0000-000000000001', 'DEMO', 'Demo Bay', 'South Africa', 'Africa/Johannesburg');

insert into berths (port_id, code, name, max_draft_m, max_loa_m, crane_rate_tph, is_anchorage) values
  ('00000000-0000-0000-0000-000000000001', 'B1', 'Bulk berth 1', 14.0, 230, 800, false),
  ('00000000-0000-0000-0000-000000000001', 'B2', 'Bulk berth 2', 12.5, 210, 650, false),
  ('00000000-0000-0000-0000-000000000001', 'CT1', 'Container berth 1', 15.5, 300, 120, false),
  ('00000000-0000-0000-0000-000000000001', 'GC1', 'General cargo berth', 10.0, 180, 300, false),
  ('00000000-0000-0000-0000-000000000001', 'SEA', 'Anchorage', null, null, null, true);

-- ---- Tugs + availability ------------------------------------------------
insert into tugs (port_id, name, bollard_pull_t, in_service_from) values
  ('00000000-0000-0000-0000-000000000001', 'TUG DEMO 1', 60, '2015-01-01'),
  ('00000000-0000-0000-0000-000000000001', 'TUG DEMO 2', 60, '2015-01-01'),
  ('00000000-0000-0000-0000-000000000001', 'TUG DEMO 3', 50, '2018-06-01'),
  ('00000000-0000-0000-0000-000000000001', 'TUG DEMO 4', 45, '2018-06-01');

insert into tug_availability_assumptions
  (port_id, gross_hours_per_year, planned_maint_h_yr, breakdown_maint_h_yr,
   starting_issues_h_yr, drydock_h_yr, shift_change_h_yr, effective_from)
values
  ('00000000-0000-0000-0000-000000000001', 8760, 60, 60, 12, 288, 360, '2026-01-01');

insert into tug_allocation_rules (port_id, priority, min_draft_m, tugs_required, min_bollard_t, note) values
  ('00000000-0000-0000-0000-000000000001', 1, 12.8, 3, 50, 'Draft >=12.8m or Capesize');
insert into tug_allocation_rules (port_id, priority, min_dwt, tugs_required, note) values
  ('00000000-0000-0000-0000-000000000001', 2, 75000, 3, 'DWT above 75,000');
insert into tug_allocation_rules (port_id, priority, max_dwt, tugs_required, note) values
  ('00000000-0000-0000-0000-000000000001', 3, 75000, 2, 'DWT up to 75,000');

-- ---- Commodities ------------------------------------------------------
insert into commodities (name, category, unit) values
  ('COKING COAL', 'energy', 'tonnes'),
  ('IRON ORE', 'metals', 'tonnes'),
  ('CONTAINER CARGO', 'container', 'teu'),
  ('LIMESTONE', 'agri', 'tonnes')
on conflict (name) do nothing;

-- ---- Cargo history: 5 years, shaped like real port trend data ----------
-- (values are illustrative, not derived from any real port's actuals)
insert into cargo_records (port_id, commodity_id, direction, year, volume)
select '00000000-0000-0000-0000-000000000001', c.id, v.direction::trade_direction, v.year, v.volume
from (values
  ('COKING COAL', 'export', 2021, 5200000), ('COKING COAL', 'export', 2022, 5450000),
  ('COKING COAL', 'export', 2023, 5100000), ('COKING COAL', 'export', 2024, 5800000),
  ('COKING COAL', 'export', 2025, 6050000),
  ('IRON ORE',    'export', 2021, 1800000), ('IRON ORE',    'export', 2022, 1650000),
  ('IRON ORE',    'export', 2023, 1900000), ('IRON ORE',    'export', 2024, 2100000),
  ('IRON ORE',    'export', 2025, 2050000),
  ('CONTAINER CARGO', 'import', 2021, 180000), ('CONTAINER CARGO', 'import', 2022, 195000),
  ('CONTAINER CARGO', 'import', 2023, 210000), ('CONTAINER CARGO', 'import', 2024, 225000),
  ('CONTAINER CARGO', 'import', 2025, 240000),
  ('LIMESTONE', 'import', 2021, 90000), ('LIMESTONE', 'import', 2022, 95000),
  ('LIMESTONE', 'import', 2023, 88000), ('LIMESTONE', 'import', 2024, 92000),
  ('LIMESTONE', 'import', 2025, 97000)
) as v(commodity, direction, year, volume)
join commodities c on c.name = v.commodity;

-- ---- A handful of illustrative vessel calls (enough to render the UI,
-- not enough to look like real traffic) -----------------------------------
insert into vessels (name, category, dwt, grt, loa_m) values
  ('DEMO CAPE VOYAGER', 'dry_bulk', 82000, 45000, 229),
  ('DEMO BAY TRADER', 'container', 65000, 52000, 260),
  ('DEMO COASTAL RUNNER', 'general_cargo', 18000, 12000, 145)
on conflict (name) do nothing;

with v1 as (select id from vessels where name = 'DEMO CAPE VOYAGER'),
     v2 as (select id from vessels where name = 'DEMO BAY TRADER'),
     v3 as (select id from vessels where name = 'DEMO COASTAL RUNNER'),
     b1 as (select id from berths where port_id = '00000000-0000-0000-0000-000000000001'::uuid and code = 'B1'),
     ct1 as (select id from berths where port_id = '00000000-0000-0000-0000-000000000001'::uuid and code = 'CT1'),
     gc1 as (select id from berths where port_id = '00000000-0000-0000-0000-000000000001'::uuid and code = 'GC1'),
     coal as (select id from commodities where name = 'COKING COAL')
insert into vessel_calls (port_id, vessel_id, vcn, purpose, ata, atb, atd, primary_berth_id, commodity_id, direction, cargo_volume_t, draft_fwd_m, draft_aft_m)
select '00000000-0000-0000-0000-000000000001'::uuid, v1.id, 'DEMO-0001', 'CARGO OPERATIONS',
       '2026-06-01T06:00:00+02:00'::timestamptz, '2026-06-01T09:00:00+02:00'::timestamptz, '2026-06-04T14:00:00+02:00'::timestamptz,
       b1.id, coal.id, 'export'::trade_direction, 72000, 13.2, 13.4
from v1, b1, coal
union all
select '00000000-0000-0000-0000-000000000001'::uuid, v2.id, 'DEMO-0002', 'CARGO OPERATIONS',
       '2026-06-05T10:00:00+02:00'::timestamptz, '2026-06-05T13:30:00+02:00'::timestamptz, '2026-06-07T08:00:00+02:00'::timestamptz,
       ct1.id, null, 'import'::trade_direction, null, 11.8, 12.0
from v2, ct1
union all
select '00000000-0000-0000-0000-000000000001'::uuid, v3.id, 'DEMO-0003', 'CARGO OPERATIONS',
       '2026-06-08T15:00:00+02:00'::timestamptz, '2026-06-08T17:00:00+02:00'::timestamptz, '2026-06-09T20:00:00+02:00'::timestamptz,
       gc1.id, null, 'import'::trade_direction, null, 8.1, 8.3
from v3, gc1;
