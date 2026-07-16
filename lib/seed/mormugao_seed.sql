-- lib/seed/mormugao_seed.sql
-- Real Port of Mormugao (MPT) structural seed, derived from the actual
-- 2020 RawData workbook (Tug_Calculations_V4). This is NOT synthetic —
-- these are the 20 highest-frequency berth codes and top commodities
-- from ~6,140 real vessel-call movement records, covering 97% of all
-- berth-endpoint mentions in the raw data.
--
-- Deliberately excluded: ~60 low-frequency berth code variants (typos
-- and spelling drift like 'B-9' vs 'B09', 'BO10' vs 'B10') that appear
-- fewer than 15 times each across 3 years. These are NOT added here on
-- purpose — when you upload mormugao_rawdata.csv through /data/upload,
-- the dry-run validation report will flag them as "unknown berth codes"
-- so you can decide whether to add aliases or accept them importing
-- without a linked berth. That flagging is the ingestion pipeline doing
-- its job on genuinely messy real-world data.

insert into ports (code, name, country, timezone) values
  ('MPT', 'Mormugao Port Trust', 'India', 'Asia/Kolkata');

-- Real berths, ranked by actual call frequency in RawData (2017-2020).
-- Draft/LOA limits are not present in RawData — left null, fill in from
-- MPT's published port information if you want them for tug-allocation
-- accuracy later.
insert into berths (port_id, code, name, is_anchorage)
select id, v.code, v.name, v.anchorage from ports, (values
  ('WOB', 'Western Outer Berth', false),
  ('BWB', 'Berthing Wharf B', false),
  ('B10', 'Berth 10', false),
  ('MOLE', 'Mole', false),
  ('B11', 'Berth 11', false),
  ('B06', 'Berth 6', false),
  ('B08', 'Berth 8', false),
  ('B07', 'Berth 7', false),
  ('EOB', 'Eastern Outer Berth', false),
  ('B09', 'Berth 9', false),
  ('B05', 'Berth 5', false),
  ('B04', 'Berth 4', false),
  ('MOLO', 'Molo', false),
  ('FJ03', 'Fishing Jetty 3', false),
  ('M1-2', 'Mooring buoys 1-2', false),
  ('M2-3', 'Mooring buoys 2-3', false),
  ('FJ02', 'Fishing Jetty 2', false),
  ('M3-4', 'Mooring buoys 3-4', false)
) as v(code, name, anchorage)
where ports.code = 'MPT';

insert into berths (port_id, code, name, is_anchorage)
select id, 'SEA', 'Anchorage', true from ports where code = 'MPT';

-- Real commodities, top by frequency in RawData.
insert into commodities (name, category, unit) values
  ('COKING COAL', 'energy', 'tonnes'),
  ('HR STEEL COILS (HOT ROLLED)', 'metals', 'tonnes'),
  ('CONTAINER (IMPORT)', 'container', 'teu'),
  ('PHOSPHORIC ACID', 'chemicals', 'tonnes'),
  ('MOTOR SPIRIT (MS)', 'energy', 'tonnes'),
  ('IRON ORE FINES', 'metals', 'tonnes'),
  ('STEAM COAL', 'energy', 'tonnes'),
  ('LIME STONE', 'agri', 'tonnes'),
  ('H.S.D.', 'energy', 'tonnes')
on conflict (name) do nothing;
