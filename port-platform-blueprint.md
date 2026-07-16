# Port Cargo Projection & Capacity Optimization Platform
## Implementation Blueprint v1.0

**Prepared for:** Capt. Ash, AUK Marine & Mining
**Date:** 14 July 2026
**Basis:** Requirements brief + structural analysis of the 2020 MPT Tug Capacity model (Tug_Calculations_V4, ~6,140 vessel-call records, 2017–2020)

**Confirmed scope decisions:**
1. Tug capacity engine is a core v1 module (formalized from the 2020 MPT model)
2. Stack: Supabase (Postgres + Auth + RLS) — Neon remains a drop-in swap later since both are plain Postgres
3. Goa data used for structure only; platform ships with schema + small synthetic demo dataset

---

# Part 1 — System Architecture

```
                        ┌─────────────────────┐
                        │   Users (browser)    │
                        │ Viewer/Editor/Admin  │
                        └──────────┬──────────┘
                                   │ HTTPS
              ┌────────────────────▼────────────────────────┐
              │                 VERCEL                       │
              │  ┌──────────────────┐  ┌─────────────────┐  │
              │  │ Next.js frontend │→ │ API routes       │  │
              │  │ (App Router)     │  │ /api/forecast    │  │
              │  │ Tailwind+shadcn  │  │ /api/optimize    │  │
              │  └──────────────────┘  │ /api/ingest      │  │
              │                        └───────┬─────────┘  │
              └───────────┬────────────────────┼────────────┘
                          │                    │
              ┌───────────▼──────────┐  ┌──────▼───────────┐
              │      SUPABASE        │  │  ANTHROPIC API    │
              │  Postgres + RLS      │  │  claude-sonnet-4-6│
              │  Auth (MFA, roles)   │  │  + web_search tool│
              │  Storage (uploads)   │  │  claude-haiku-4-5 │
              └──────────────────────┘  └───────────────────┘

              GitHub repo ──push──▶ Vercel auto-deploy
```

**Design principles**

- **All computation server-side.** BOR, queueing, tug-hours and Claude calls live in Next.js API routes (or Supabase Edge Functions). The browser only renders. The `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` never ship to the client.
- **Port is a first-class dimension.** Every operational table carries `port_id`. Adding Durban means inserting one row in `ports`, its berths, its tugs, and mapping its VTS export to the ingestion format — no code changes.
- **Two-layer analytics** (same pattern as your PMS app): deterministic local math (BOR, Erlang C, tug-hours) computed in TypeScript, plus on-demand Claude narrative/projection analysis. Numbers are reproducible; the LLM interprets, it never invents arithmetic.
- **Movements are the atomic unit**, not calls. This is the lesson from the 2020 model: one call generates 2+ piloted movements (incoming, shifting(s), sailing), each with its own tug assignments and times. Calls are parents; movements are children; tug jobs are grandchildren.

---

# Part 2 — PostgreSQL Schema (DDL)

Run this in the Supabase SQL Editor as a single script. It is idempotent-unsafe (plain `create`), so run once on a fresh project.

```sql
-- ============================================================
-- 0. ENUMS
-- ============================================================
create type user_role as enum ('viewer', 'editor', 'admin');

create type vessel_category as enum (
  'dry_bulk', 'liquid_bulk', 'container', 'breakbulk',
  'general_cargo', 'transhipper', 'passenger', 'naval_coastguard',
  'barge_craft', 'research', 'other'
);

create type movement_type as enum ('incoming', 'sailing', 'shifting');

create type trade_direction as enum ('import', 'export', 'transhipment', 'coastal');

create type forecast_scenario as enum ('optimistic', 'baseline', 'conservative');

-- ============================================================
-- 1. REFERENCE / CONFIGURATION TABLES
-- ============================================================
create table ports (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,          -- 'MPT', 'ZADUR', 'ZARCB'
  name          text not null,                 -- 'Mormugao Port Trust'
  country       text not null,
  timezone      text not null default 'UTC',   -- 'Africa/Johannesburg'
  created_at    timestamptz not null default now()
);

create table berths (
  id              uuid primary key default gen_random_uuid(),
  port_id         uuid not null references ports(id) on delete cascade,
  code            text not null,               -- 'B06', 'WOB', 'MOLE'
  name            text,
  max_draft_m     numeric(5,2),
  max_loa_m       numeric(6,2),
  crane_rate_tph  numeric(8,2),                -- design handling rate, tons/hour
  is_anchorage    boolean not null default false, -- SEA / anchorage pseudo-berths
  active          boolean not null default true,
  unique (port_id, code)
);

create table tugs (
  id               uuid primary key default gen_random_uuid(),
  port_id          uuid not null references ports(id) on delete cascade,
  name             text not null,               -- 'TUG OCEAN'
  bollard_pull_t   numeric(5,1),                -- tonnes
  in_service_from  date,
  out_of_service   date,                        -- null = still active
  unique (port_id, name)
);

-- Per-port tug availability assumptions (the 2020 model's deduction table)
create table tug_availability_assumptions (
  id                       uuid primary key default gen_random_uuid(),
  port_id                  uuid not null references ports(id) on delete cascade,
  gross_hours_per_year     numeric(7,1) not null default 8760,
  planned_maint_h_yr       numeric(6,1) not null default 60,
  breakdown_maint_h_yr     numeric(6,1) not null default 60,
  starting_issues_h_yr     numeric(6,1) not null default 12,
  drydock_h_yr             numeric(6,1) not null default 288,  -- 20 days / 2.5 yr amortized
  shift_change_h_yr        numeric(6,1) not null default 360,
  effective_from           date not null default current_date,
  unique (port_id, effective_from)
);

-- Tug allocation rules, data-driven (2 tugs <=75k DWT, 3 above, 3 if draft >=12.8m)
create table tug_allocation_rules (
  id             uuid primary key default gen_random_uuid(),
  port_id        uuid not null references ports(id) on delete cascade,
  priority       int not null,                 -- evaluated ascending; first match wins
  min_dwt        numeric(10,0),
  max_dwt        numeric(10,0),
  min_draft_m    numeric(5,2),
  tugs_required  int not null,
  min_bollard_t  numeric(5,1),
  note           text,
  unique (port_id, priority)
);

create table commodities (
  id          uuid primary key default gen_random_uuid(),
  name        text unique not null,            -- 'COKING COAL', 'IRON ORE'
  category    text,                            -- 'energy', 'metals', 'agri', 'container'
  unit        text not null default 'tonnes'   -- 'tonnes' | 'teu'
);

-- ============================================================
-- 2. OPERATIONAL DATA (the RawData equivalent, normalized)
-- ============================================================
create table vessels (
  id        uuid primary key default gen_random_uuid(),
  imo       text unique,                       -- nullable: naval/craft have none
  name      text not null,
  category  vessel_category not null default 'other',
  dwt       numeric(10,0),
  grt       numeric(10,0),
  loa_m     numeric(6,2)
);
create unique index idx_vessels_name on vessels (name);

create table vessel_calls (
  id               uuid primary key default gen_random_uuid(),
  port_id          uuid not null references ports(id),
  vessel_id        uuid not null references vessels(id),
  vcn              text,                       -- port's own call number
  purpose          text,                       -- 'CARGO OPERATIONS', 'DEFENCE'
  ata              timestamptz not null,       -- actual time of arrival
  atb              timestamptz,                -- actual time of berthing (first berth)
  atd              timestamptz,                -- actual time of departure
  primary_berth_id uuid references berths(id),
  commodity_id     uuid references commodities(id),
  direction        trade_direction,
  cargo_volume_t   numeric(12,2),
  handling_rate_tph numeric(8,2),
  draft_fwd_m      numeric(5,2),
  draft_aft_m      numeric(5,2),
  source_file      text,                       -- ingestion provenance
  created_at       timestamptz not null default now(),
  unique (port_id, vcn)
);
create index idx_calls_port_ata   on vessel_calls (port_id, ata);
create index idx_calls_berth      on vessel_calls (primary_berth_id);
create index idx_calls_commodity  on vessel_calls (commodity_id);

-- One call -> many piloted movements (the 2020 model's key insight)
create table movements (
  id             uuid primary key default gen_random_uuid(),
  call_id        uuid not null references vessel_calls(id) on delete cascade,
  movement_type  movement_type not null,
  from_location  text not null,                -- berth code, 'SEA', anchorage
  to_location    text not null,
  started_at     timestamptz,
  completed_at   timestamptz,
  pilot_name     text,
  is_dead_tow    boolean not null default false
);
create index idx_movements_call on movements (call_id);
create index idx_movements_time on movements (started_at);

-- One movement -> 0..4 tug jobs, each individually timed
create table movement_tugs (
  id           uuid primary key default gen_random_uuid(),
  movement_id  uuid not null references movements(id) on delete cascade,
  tug_id       uuid not null references tugs(id),
  tug_order    int not null,                   -- 1..4
  start_at     timestamptz,
  end_at       timestamptz,
  unique (movement_id, tug_order)
);
create index idx_mt_tug on movement_tugs (tug_id);

-- Recorded delays (the delay-report side of the 2020 model)
create table delay_events (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid not null references vessel_calls(id) on delete cascade,
  cause        text not null,                  -- 'tugs_busy', 'berth_not_ready', 'cargo_not_ready'
  delay_hours  numeric(6,2) not null,
  note         text
);

-- ============================================================
-- 3. CARGO HISTORY & FORECASTS
-- ============================================================
create table cargo_records (                   -- annual actuals per commodity
  id           uuid primary key default gen_random_uuid(),
  port_id      uuid not null references ports(id),
  commodity_id uuid not null references commodities(id),
  direction    trade_direction not null,
  year         int not null,
  volume       numeric(14,2) not null,
  unique (port_id, commodity_id, direction, year)
);
create index idx_cargo_port_year on cargo_records (port_id, year);

create table forecast_runs (                   -- one row per Claude invocation
  id            uuid primary key default gen_random_uuid(),
  port_id       uuid not null references ports(id),
  requested_by  uuid,                          -- auth.users id
  model         text not null,                 -- 'claude-sonnet-4-6'
  horizon_months int not null,                 -- 12 | 24 | 36
  prompt_hash   text,
  raw_response  jsonb,                         -- full audit trail
  created_at    timestamptz not null default now()
);

create table cargo_forecasts (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references forecast_runs(id) on delete cascade,
  port_id        uuid not null references ports(id),
  commodity_id   uuid not null references commodities(id),
  direction      trade_direction not null,
  scenario       forecast_scenario not null,
  period_start   date not null,                -- month or year granularity
  volume         numeric(14,2) not null check (volume >= 0),  -- fixes the Excel negative-forecast problem
  rationale      text,                         -- Claude's stated driver, 1-2 sentences
  unique (run_id, commodity_id, direction, scenario, period_start)
);
create index idx_fc_port_period on cargo_forecasts (port_id, period_start);

-- ============================================================
-- 4. AUTH PROFILE + RLS
-- ============================================================
create table profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text,
  role  user_role not null default 'viewer'
);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper: current user's role
create or replace function public.my_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- Enable RLS everywhere
alter table ports            enable row level security;
alter table berths           enable row level security;
alter table tugs             enable row level security;
alter table tug_availability_assumptions enable row level security;
alter table tug_allocation_rules enable row level security;
alter table commodities      enable row level security;
alter table vessels          enable row level security;
alter table vessel_calls     enable row level security;
alter table movements        enable row level security;
alter table movement_tugs    enable row level security;
alter table delay_events     enable row level security;
alter table cargo_records    enable row level security;
alter table forecast_runs    enable row level security;
alter table cargo_forecasts  enable row level security;
alter table profiles         enable row level security;

-- Policy pattern: everyone authenticated reads; editor+ writes operational
-- data; admin only for configuration. Applied via a loop for brevity:
do $$
declare t text;
begin
  foreach t in array array[
    'ports','berths','tugs','tug_availability_assumptions','tug_allocation_rules',
    'commodities','vessels','vessel_calls','movements','movement_tugs',
    'delay_events','cargo_records','forecast_runs','cargo_forecasts']
  loop
    execute format('create policy "read_all_%s" on %I for select to authenticated using (true)', t, t);
  end loop;
end $$;

-- Editor+ can write operational data
do $$
declare t text;
begin
  foreach t in array array[
    'vessels','vessel_calls','movements','movement_tugs','delay_events',
    'cargo_records','forecast_runs','cargo_forecasts']
  loop
    execute format(
      'create policy "editor_write_%s" on %I for all to authenticated
       using (public.my_role() in (''editor'',''admin''))
       with check (public.my_role() in (''editor'',''admin''))', t, t);
  end loop;
end $$;

-- Admin only for configuration tables
do $$
declare t text;
begin
  foreach t in array array[
    'ports','berths','tugs','tug_availability_assumptions',
    'tug_allocation_rules','commodities']
  loop
    execute format(
      'create policy "admin_write_%s" on %I for all to authenticated
       using (public.my_role() = ''admin'')
       with check (public.my_role() = ''admin'')', t, t);
  end loop;
end $$;

-- Profiles: users see own row; admin sees/edits all
create policy "own_profile" on profiles for select to authenticated
  using (id = auth.uid() or public.my_role() = 'admin');
create policy "admin_manage_profiles" on profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
```

**Schema-to-workbook mapping** (how a VTS export like your RawData lands):

| RawData column | Destination |
|---|---|
| VCN | `vessel_calls.vcn` |
| VESSEL TYPE / NAME / GRT / DWT / LOA | `vessels` (upsert on name+IMO) |
| Arrival Date + Time | `vessel_calls.ata` |
| FROM BERTH / TO BERTH | one `movements` row (type inferred: SEA→berth = incoming, berth→SEA = sailing, berth→berth = shifting) |
| Berth Dt/Tm, Un-Berth Dt/Tm | `vessel_calls.atb` / `atd` |
| Tug1..Tug4 + St/En tm | up to 4 `movement_tugs` rows |
| PILOT | `movements.pilot_name` |
| FWD / AFT | `vessel_calls.draft_fwd_m` / `draft_aft_m` |
| CARGO | `commodities` lookup → `vessel_calls.commodity_id` |

---

# Part 3 — Core Optimization Algorithms (TypeScript)

Place these in `lib/optimization/`. They are pure functions — no database access — so they are unit-testable and can run in API routes or Edge Functions unchanged.

## 3.1 Berth Occupancy Ratio

```typescript
// lib/optimization/bor.ts

export interface BerthOccupancyInput {
  /** Sum of hours each berth was occupied over the period */
  occupiedHoursPerBerth: Record<string, number>;
  /** Number of berths in the group being evaluated */
  berthCount: number;
  /** Evaluation period length in hours (e.g. 8760 for a year) */
  periodHours: number;
}

export function berthOccupancyRatio(i: BerthOccupancyInput): number {
  const totalOccupied = Object.values(i.occupiedHoursPerBerth)
    .reduce((a, b) => a + b, 0);
  return (totalOccupied / (i.berthCount * i.periodHours)) * 100;
}

// UNCTAD guidance thresholds for interpretation (surface these in the UI):
// BOR < 40%  -> under-utilized
// 40–70%     -> healthy band (varies by berth count; more berths tolerate higher BOR)
// > 70%      -> congestion risk; waiting time grows non-linearly
```

## 3.2 M/M/c Queueing (Erlang C)

```typescript
// lib/optimization/queueing.ts

export interface MMcInput {
  lambda: number;  // arrival rate, vessels per hour
  mu: number;      // service rate per berth, vessels per hour (1 / mean service time)
  c: number;       // number of berths (servers)
}

export interface MMcResult {
  rho: number;        // utilization per server
  pWait: number;      // Erlang C: probability an arriving vessel waits
  Lq: number;         // average queue length (vessels at anchorage)
  Wq: number;         // average waiting time (hours)
  W: number;          // average total time in system (wait + service)
  stable: boolean;    // false if rho >= 1 (queue grows without bound)
}

export function mmcQueue({ lambda, mu, c }: MMcInput): MMcResult {
  const a = lambda / mu;          // offered load (Erlangs)
  const rho = a / c;
  if (rho >= 1) {
    return { rho, pWait: 1, Lq: Infinity, Wq: Infinity, W: Infinity, stable: false };
  }
  // Erlang C, computed iteratively to avoid factorial overflow
  let sum = 0;
  let term = 1;                   // a^k / k! at k = 0
  for (let k = 0; k < c; k++) {
    sum += term;
    term = (term * a) / (k + 1);
  }
  const acOverCfact = term;       // a^c / c!
  const erlangC =
    (acOverCfact / (1 - rho)) / (sum + acOverCfact / (1 - rho));
  const Lq = (erlangC * rho) / (1 - rho);
  const Wq = Lq / lambda;
  return { rho, pWait: erlangC, Lq, Wq, W: Wq + 1 / mu, stable: true };
}
```

**M/G/c note.** Real berth service times are not exponential (a Capesize coal discharge is not memoryless). For M/G/c use the standard approximation
`Wq(M/G/c) ≈ Wq(M/M/c) × (1 + CV²) / 2`, where CV is the coefficient of variation of observed service times — computable directly from `vessel_calls.atb`/`atd`. Ship this as `mgcQueue()` wrapping the function above.

## 3.3 Tug Capacity Engine (formalized from the 2020 MPT model)

```typescript
// lib/optimization/tugs.ts

export interface TugMovementStats {
  /** Average tug-hours per job, by movement type — computed from movement_tugs */
  avgHours: { incoming: number; sailing: number; shifting: number };
  /** Projected annual number of jobs, by movement type */
  annualJobs: { incoming: number; sailing: number; shifting: number };
}

export interface TugAvailability {
  fleetSize: number;
  grossHoursPerTugYear: number;   // default 8760
  deductionsPerTugYear: number;   // maint + breakdown + starting + drydock + shift change
}

export interface TugCapacityResult {
  requiredHours: number;
  availableHours: number;
  utilization: number;            // required / available
  headroomHours: number;
  additionalTugsNeeded: number;   // 0 if headroom >= 0
}

export function tugCapacity(
  stats: TugMovementStats,
  avail: TugAvailability
): TugCapacityResult {
  const required =
    stats.avgHours.incoming * stats.annualJobs.incoming +
    stats.avgHours.sailing  * stats.annualJobs.sailing  +
    stats.avgHours.shifting * stats.annualJobs.shifting;

  const netPerTug = avail.grossHoursPerTugYear - avail.deductionsPerTugYear;
  const available = avail.fleetSize * netPerTug;
  const headroom = available - required;

  return {
    requiredHours: required,
    availableHours: available,
    utilization: required / available,
    headroomHours: headroom,
    additionalTugsNeeded: headroom >= 0 ? 0 : Math.ceil(-headroom / netPerTug),
  };
}

/** Allocation rule engine — evaluates tug_allocation_rules rows by priority.
 *  Default ruleset mirrors the 2020 MPT model. */
export interface AllocationRule {
  priority: number;
  minDwt?: number; maxDwt?: number; minDraftM?: number;
  tugsRequired: number; minBollardT?: number;
}

export function tugsForVessel(
  dwt: number, draftM: number, rules: AllocationRule[]
): { tugs: number; minBollardT?: number } {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    const dwtOk =
      (r.minDwt === undefined || dwt >= r.minDwt) &&
      (r.maxDwt === undefined || dwt <= r.maxDwt);
    const draftOk = r.minDraftM === undefined || draftM >= r.minDraftM;
    if (dwtOk && draftOk) return { tugs: r.tugsRequired, minBollardT: r.minBollardT };
  }
  return { tugs: 2 }; // conservative default
}

// Seed rules (insert into tug_allocation_rules):
// priority 1: minDraftM 12.8            -> 3 tugs, minBollard 50
// priority 2: minDwt 75000              -> 3 tugs
// priority 3: maxDwt 75000              -> 2 tugs
```

**Delay trigger** (the 2020 model's decision rule): if
`(delay_hours attributable to 'tugs_busy') × vessel time-cost > annual charter hire of one tug`, or delayed vessels exceed the port-set trigger point (MPT used 1% of calls), recommend fleet expansion. Both thresholds are configuration, not code.

## 3.4 Bottleneck Classifier

```typescript
// lib/optimization/bottleneck.ts
// Rule-of-thumb classifier; the Claude layer narrates the result.

export type Bottleneck = 'sea_side' | 'storage_side' | 'land_side' | 'tug_side' | 'none';

export function classifyBottleneck(m: {
  bor: number;                 // %
  avgWaitHours: number;
  tugUtilization: number;      // 0..1
  yardUtilization: number;     // 0..1
  evacuationRatio: number;     // cargo evacuated / cargo landed, trailing 30d
}): Bottleneck {
  if (m.tugUtilization > 0.85 && m.avgWaitHours > 2) return 'tug_side';
  if (m.bor > 70 && m.avgWaitHours > 6)              return 'sea_side';
  if (m.yardUtilization > 0.85)                      return 'storage_side';
  if (m.evacuationRatio < 0.9)                       return 'land_side';
  return 'none';
}
```

---

# Part 4 — UI Routes & Wireframe

Next.js App Router layout. One route group per concern; middleware enforces auth on everything except `/login`.

```
app/
├── login/                        Supabase Auth UI (email+password, MFA enrol)
├── (dashboard)/
│   ├── page.tsx                  DASHBOARD — port selector, KPI cards
│   │                             (BOR, Wq, tug utilization, calls YTD),
│   │                             cargo trend chart, bottleneck banner
│   ├── data/
│   │   ├── calls/                Vessel-call grid (paginated, filter by
│   │   │                         berth/commodity/date). Editor: inline edit.
│   │   ├── upload/               CSV/XLSX upload → column-mapping step →
│   │   │                         validation report → commit. (Editor+)
│   │   └── cargo/                Annual cargo actuals per commodity (Editor+)
│   ├── capacity/
│   │   ├── berths/               BOR per berth, occupancy Gantt, M/M/c panel
│   │   │                         with what-if sliders (λ, μ, c)
│   │   └── tugs/                 Tug engine: fleet table, hours required vs
│   │                             available gauge, allocation-rule editor
│   │                             (Admin), delay log
│   ├── projections/
│   │   ├── page.tsx              Forecast runs list + "New projection" button
│   │   └── [runId]/              3-scenario fan chart per commodity, Claude
│   │                             rationale panel, export to CSV
│   └── settings/                 (Admin) ports, berths, tugs, availability
│                                 assumptions, users & roles
├── api/
│   ├── ingest/route.ts           POST multipart — parse, map, validate, insert
│   ├── optimize/route.ts         POST { portId, period } — returns BOR/queue/tug metrics
│   └── forecast/route.ts         POST { portId, horizonMonths } — Claude pipeline (Part 5)
└── middleware.ts                 Session check + role gate per route group
```

**Wireframe conventions:** navy `#0b1f3a` sidebar with gold `#c9a227` accents (your established AUK theme maps cleanly onto shadcn CSS variables); KPI cards top row; charts via Recharts; data grids via TanStack Table; every metric card carries an info popover stating its formula — consistent with your fact-vs-inference standard.

---

# Part 5 — Claude API Pipeline (Cargo Projection Engine)

## 5.1 Design rules

1. **Claude never does arithmetic the platform depends on.** The deterministic trend (linear/CAGR per commodity) is computed in TypeScript and *given* to Claude as the baseline. Claude's job is judgment: adjust the baseline for market drivers and return structured deltas + rationale.
2. **Two-model split:** `claude-haiku-4-5` for cheap classification (mapping messy VTS cargo strings → canonical commodities during ingestion); `claude-sonnet-4-6` with the `web_search` tool for projections.
3. **Strict JSON out.** Response is parsed, validated with Zod, clamped to `volume >= 0`, and only then written to `cargo_forecasts`. The full raw response is archived in `forecast_runs.raw_response` for audit.

## 5.2 System prompt (paste verbatim into the API route)

```
You are a maritime trade analyst producing cargo volume projections for a
specific port. You will receive: (a) the port profile, (b) historical annual
volumes per commodity and direction, (c) a deterministic statistical baseline
projection computed from that history, and (d) the projection horizon.

Your task: adjust the statistical baseline using current market intelligence
(commodity demand, trade-route shifts, regional infrastructure, policy) and
produce three scenarios per commodity: optimistic, baseline, conservative.

Rules:
1. Use web search to check current conditions for the port's top commodities
   before projecting. Cite the driver, not the URL, in each rationale.
2. Never project a negative volume. A collapsing trade goes to a small
   positive floor, not below zero.
3. Scenario spread must be justified: state in the rationale what would have
   to be true for optimistic vs conservative.
4. Keep each rationale to at most 2 sentences, plain factual register,
   distinguishing established fact from your inference.
5. Respond ONLY with JSON matching the provided schema. No preamble, no
   markdown fences, no commentary outside the JSON.
```

## 5.3 Request payload structure

```typescript
// app/api/forecast/route.ts (server only)
const body = {
  model: "claude-sonnet-4-6",
  max_tokens: 8000,
  system: SYSTEM_PROMPT,                       // 5.2 above
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
  messages: [{
    role: "user",
    content: JSON.stringify({
      port: { code: "ZADUR", name: "Port of Durban", country: "South Africa" },
      horizon_months: 24,
      history: [
        { commodity: "COKING COAL", direction: "import",
          annual: { "2021": 8514106, "2022": 6065914, "2023": 6902828 } }
        // ... one entry per commodity
      ],
      statistical_baseline: [
        { commodity: "COKING COAL", direction: "import",
          method: "linear_trend",
          projection: { "2026": 6400000, "2027": 6250000 } }
      ],
      response_schema: {
        forecasts: [{
          commodity: "string (must match an input commodity exactly)",
          direction: "import|export",
          scenario: "optimistic|baseline|conservative",
          period_start: "YYYY-01-01",
          volume: "number >= 0",
          rationale: "string, <=2 sentences"
        }]
      }
    })
  }]
};
```

## 5.4 Response handling (Zod gate)

```typescript
import { z } from "zod";

const Forecast = z.object({
  commodity: z.string(),
  direction: z.enum(["import", "export"]),
  scenario: z.enum(["optimistic", "baseline", "conservative"]),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  volume: z.number().min(0),
  rationale: z.string().max(400),
});
const ForecastResponse = z.object({ forecasts: z.array(Forecast).min(1) });

// Assemble text blocks only (web_search responses interleave tool blocks):
const text = data.content
  .filter((b: any) => b.type === "text")
  .map((b: any) => b.text).join("\n")
  .replace(/```json|```/g, "").trim();

const parsed = ForecastResponse.parse(JSON.parse(text)); // throws -> 422 to UI
// then: insert forecast_runs row, bulk-insert cargo_forecasts, return runId
```

---

# Part 6 — Step-by-Step Deployment Guide

One action per step. Each checkpoint tells you what you must see before continuing.

**Step 1 — Create the GitHub repository.**
Go to github.com → New repository → name `port-capacity-platform` → Private → Create.
✅ Checkpoint: empty repo page showing the HTTPS clone URL.

**Step 2 — Scaffold the app locally.** In a terminal:
```bash
npx create-next-app@latest port-capacity-platform --typescript --tailwind --app --eslint
cd port-capacity-platform
npx shadcn@latest init
npm install @supabase/supabase-js @supabase/ssr zod recharts @tanstack/react-table
```
✅ Checkpoint: `npm run dev` serves the starter page at localhost:3000.

**Step 3 — Create the Supabase project.**
supabase.com → New project → name `port-platform` → region closest to users (eu-west for SA) → generate a strong DB password and store it in your password manager.
✅ Checkpoint: project dashboard loads; Settings → API shows Project URL and anon key.

**Step 4 — Run the schema.**
Supabase dashboard → SQL Editor → New query → paste the entire Part 2 DDL → Run.
✅ Checkpoint: "Success. No rows returned" and Table Editor lists all 15 tables.

**Step 5 — Enable MFA.**
Authentication → Providers → Email: on. Authentication → MFA → enable TOTP.
✅ Checkpoint: MFA shows "Enabled".

**Step 6 — Create your admin user.**
Authentication → Users → Add user → your email + password. Then SQL Editor:
```sql
update profiles set role = 'admin' where email = 'you@auk-maritime.com';
```
✅ Checkpoint: `select email, role from profiles;` returns your row as `admin`.

**Step 7 — Local environment file.** Create `.env.local` in the project root:
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
ANTHROPIC_API_KEY=YOUR-ANTHROPIC-KEY
```
Confirm `.gitignore` already contains `.env*`.
✅ Checkpoint: `git status` does NOT list `.env.local`.

**Step 8 — First push.**
```bash
git add -A
git commit -m "Scaffold: Next.js + Supabase schema + optimization libs"
git branch -M main
git remote add origin https://github.com/YOUR-USER/port-capacity-platform.git
git push -u origin main
```
✅ Checkpoint: files visible on GitHub.

**Step 9 — Connect Vercel.**
vercel.com → Add New → Project → import `port-capacity-platform` → framework auto-detects Next.js → before deploying, open Environment Variables and add all four variables from Step 7 (Production + Preview) → Deploy.
✅ Checkpoint: build succeeds; `*.vercel.app` URL serves the app.

**Step 10 — Smoke test the forecast route.**
```bash
curl -X POST https://YOUR-APP.vercel.app/api/forecast \
  -H "Content-Type: application/json" \
  -d '{"portId":"DEMO","horizonMonths":12}'
```
✅ Checkpoint: JSON response containing a `runId`, and a new row in `forecast_runs`.

**Step 11 — Ongoing workflow** (same pattern as auk-marketing-deploy):
edit → `git add -A && git commit -m "..." && git push` → Vercel auto-deploys in ~60s.

---

# Build Order (recommended sprint sequence)

1. **Sprint 1 — Foundation:** Steps 1–9 above; auth + role middleware; empty dashboard shell.
2. **Sprint 2 — Data in:** ingestion route with column mapping (modeled on the RawData layout), vessel-call grid, movement derivation logic.
3. **Sprint 3 — Deterministic engine:** BOR, M/M/c, tug capacity, bottleneck classifier + capacity screens with what-if sliders.
4. **Sprint 4 — Claude engine:** forecast pipeline, scenario fan charts, rationale panel.
5. **Sprint 5 — Hardening:** M/G/c refinement, synthetic demo dataset, CSV export, admin settings, first SA port onboarding (Durban).
