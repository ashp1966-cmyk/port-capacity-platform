# Durban Onboarding — Port of Durban (ZADUR)

Structure below is grounded in public TNPA/Transnet Port Terminals documentation
(sourced 14 July 2026: transnetnationalportsauthority.net, transnetportterminals.net).
**This is a starting structure, not a verified operational dataset** — precise berth
codes, coordinates, and current draft figures should be confirmed with your Durban
port office contact before this goes live, per your own working preference for
fact-vs-inference discipline.

## What's confirmed from public sources

- **Durban Container Terminal** operates as two precincts:
  - **Pier 1** — 2 operational container berths, ~3,800 ground slots, 0.7M TEU capacity, plus a 5-berth lay-by area with no fixed superstructure.
  - **Pier 2** — 6 operational berths, ~15,704 ground slots, 2.4M TEU capacity. Berths are ~12.8m deep with a **12.2m permissible draft** at the operational berths (larger Post/Super-Panamax vessels can only call partially laden until berths are deepened).
- **Car Terminal** — serviced by road and rail; permissible draft **10.3m–11.9m**.
- **Fruit/Produce Terminal** — Berths **O and P**; permissible draft **10.3m**.
- **General cargo** — Berths **C, D, E** for Transnet Port Terminals general cargo (road + rail for containers); permissible draft **9.9m–12.6m**.
- **Cruise Terminal** — Berths **A and B** at Point Precinct (concession-based).
- **Ro-Ro Terminal** — South Africa's largest, in the Durban Harbour precinct, road+rail access, ~50km from King Shaka International Airport.
- **N-shed** — currently the Passenger Terminal (a new purpose-built one is planned).
- **Tug jetty** — where the TNPA Marine Fleet (tugs, pilot boats, workboats) berths.
- **Dredging in progress**: terminal draft at DCT being deepened toward **16m**.
- Port office: 202 Anton Lembede Str., Durban Central, 4001. TPT call centre: tptcallcentre@transnet.net.

## What's NOT yet confirmed — needs your input before go-live

- Exact numbered/lettered berth codes at Pier 1 and Pier 2 (public pages describe berth *counts* and *precincts*, not a full code list like your MPT RawData's B04/B06/WOB scheme).
- Current TNPA tug fleet size and bollard-pull ratings for Durban specifically.
- Whether Durban's VTS export uses the same column layout as the 2020 MPT sheet, or a different format — this determines whether the ingestion column-mapping step (Sprint 2) needs new auto-map entries.
- Local delay-trigger point and tug-allocation policy (the MPT sheet used 2/3 tugs by 75,000 DWT and 12.8m draft — Durban's harbour master may use different thresholds).

## Seed script

```sql
-- Structural skeleton only — codes marked (confirm) need your Durban contact.
insert into ports (code, name, country, timezone) values
  ('ZADUR', 'Port of Durban', 'South Africa', 'Africa/Johannesburg');

-- Berths: precinct-level placeholders using the confirmed public structure.
-- Replace with actual numbered codes once confirmed.
insert into berths (port_id, code, name, max_draft_m, is_anchorage)
select id, v.code, v.name, v.draft, false from ports, (values
  ('DCT-P1-1', 'Durban Container Terminal, Pier 1 (confirm exact berth no.)', 12.2),
  ('DCT-P1-2', 'Durban Container Terminal, Pier 1 (confirm exact berth no.)', 12.2),
  ('DCT-P2-1', 'Durban Container Terminal, Pier 2 (confirm exact berth no.)', 12.2),
  ('DCT-P2-2', 'Durban Container Terminal, Pier 2 (confirm exact berth no.)', 12.2),
  ('DCT-P2-3', 'Durban Container Terminal, Pier 2 (confirm exact berth no.)', 12.2),
  ('DCT-P2-4', 'Durban Container Terminal, Pier 2 (confirm exact berth no.)', 12.2),
  ('DCT-P2-5', 'Durban Container Terminal, Pier 2 (confirm exact berth no.)', 12.2),
  ('DCT-P2-6', 'Durban Container Terminal, Pier 2 (confirm exact berth no.)', 12.2),
  ('C', 'General cargo berth C', 12.6),
  ('D', 'General cargo berth D', 12.6),
  ('E', 'General cargo berth E', 9.9),
  ('O', 'Fruit/Produce Terminal berth O', 10.3),
  ('P', 'Fruit/Produce Terminal berth P', 10.3),
  ('A', 'Cruise Terminal berth A (Point Precinct)', null),
  ('B', 'Cruise Terminal berth B (Point Precinct)', null)
) as v(code, name, draft)
where ports.code = 'ZADUR';

insert into berths (port_id, code, name, is_anchorage)
select id, 'SEA', 'Anchorage', true from ports where code = 'ZADUR';
```

## Onboarding checklist (one action at a time)

1. Run the Durban seed script above in Supabase SQL Editor.
   ✅ Checkpoint: `select code, name from berths where port_id = (select id from ports where code='ZADUR')` returns 16 rows.
2. Confirm exact berth codes with your Durban office contact; run `update berths set code = '...' where id = '...'` for each placeholder.
3. Register Durban's tug fleet in Settings → Tugs (Sprint 5 admin screen) once fleet size and bollard ratings are confirmed.
4. Set Durban's tug availability assumptions (Settings → Tugs) — MPT's 780h/tug/year deduction total is a starting default, not a Durban fact.
5. Confirm Durban's VTS export column layout; extend `HEADER_MAP` in `lib/ingest/parseRawData.ts` if it differs from MPT's RawData headers.
6. Run a small test upload (a few weeks of real calls) through `/data/upload` in dry-run mode before committing.
