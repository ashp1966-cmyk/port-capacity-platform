# Port Cargo Projection & Capacity Optimization Platform

Built for AUK Marine & Mining. Full implementation of the five-sprint
blueprint: ingestion, berth/tug capacity engine, Claude-driven cargo
projections, and admin hardening.

## Quick start

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in real values
   (Supabase project URL/keys, Anthropic API key).
3. Run the schema DDL (Part 2 of the blueprint) in the Supabase SQL
   Editor, then optionally `lib/seed/demo_seed.sql` for a non-empty
   first login.
4. `npm run dev` — http://localhost:3000

See `port-platform-blueprint.md` for the full architecture, schema,
and deployment guide; `lib/seed/durban_onboarding.md` for Durban-specific
setup.

## Structure

- `lib/ingest/` — VTS export parser (Sprint 2)
- `lib/optimization/` — BOR, M/M/c queueing, tug capacity (Sprint 3)
- `lib/forecast/` — deterministic baseline + Claude response schema (Sprint 4)
- `lib/export/`, `lib/seed/` — CSV export, demo/Durban seed data (Sprint 5)
- `app/(dashboard)/` — all UI screens
- `app/api/` — all server routes
