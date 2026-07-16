// lib/ingest/parseRawData.ts
// Pure functions only — no I/O, no database. Unit-testable in isolation.
//
// Pipeline: RawRow[]  ->  group by VCN  ->  ParsedCall[] (+ ValidationIssue[])
//
// Semantics learned from the 2020 MPT RawData sheet:
//   * Each spreadsheet ROW is one piloted MOVEMENT (it has one FROM/TO pair
//     and up to four tug assignments). A vessel CALL that arrives, shifts
//     once and sails appears as three rows sharing a VCN.
//   * FROM=SEA, TO=berth        -> incoming
//   * FROM=berth, TO=SEA        -> sailing
//   * FROM=berth, TO=berth      -> shifting
//   * Naval/craft rows may have DWT=0, blank cargo, no IMO — valid rows.

import type {
  RawRow, ParsedCall, ParsedMovement, ParsedTugJob, ParsedVessel,
  MovementType, VesselCategory, ValidationIssue, IngestReport,
} from './types';

// ------------------------------------------------------------------
// 1. Header normalization
// ------------------------------------------------------------------
// Maps the exact RawData headers (typos included) to RawRow fields.
// Extend this map per port — Durban's VTS export will differ only here.

const HEADER_MAP: Record<string, string> = {
  'VCN': 'vcn',
  'VESSEL TYPE': 'vesselType',
  'VESSEL NAME': 'vesselName',
  'PUPOSE OF VISIT': 'purpose',        // sic — as in the source file
  'PURPOSE OF VISIT': 'purpose',
  'ARRIVAL DATE': 'arrivalDate',
  'ARRIVAL TIME': 'arrivalTime',
  'GRT': 'grt',
  'DWT': 'dwt',
  'CARGO': 'cargo',
  'LOA': 'loa',
  'FWD': 'draftFwd',
  'AFT': 'draftAft',
  'FROM BERTH': 'fromBerth',
  'TO BERTH': 'toBerth',
  'BERTH DT': 'berthDate',
  'BERTH TM': 'berthTime',
  'UN-BERTH DT': 'unberthDate',
  'UN-BERTH TM': 'unberthTime',
  'PILOT': 'pilot',
};

/** Convert a header-keyed record (e.g. from papaparse / SheetJS
 *  sheet_to_json) into a RawRow. Unknown headers are ignored. */
export function normalizeRow(record: Record<string, unknown>): RawRow {
  const out: Record<string, unknown> = { tugs: [] };
  const tugs: RawRow['tugs'] = [];

  for (const [rawKey, value] of Object.entries(record)) {
    const key = rawKey.trim().toUpperCase();
    const str = value == null || value === '' ? null : String(value).trim();

    const mapped = HEADER_MAP[key];
    if (mapped) { out[mapped] = str; continue; }

    // TUG1 / TUG1 ST TM / TUG1 EN TM ... TUG4 ...
    const m = key.match(/^TUG\s?([1-4])(?:\s+(ST|EN)\s?TM)?$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      tugs[idx] = tugs[idx] ?? { name: null, start: null, end: null };
      if (!m[2]) tugs[idx].name = str;
      else if (m[2] === 'ST') tugs[idx].start = str;
      else tugs[idx].end = str;
    }
  }
  out.tugs = tugs.filter(t => t && (t.name || t.start || t.end));
  return out as unknown as RawRow;
}

// ------------------------------------------------------------------
// 2. Primitive parsers
// ------------------------------------------------------------------

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // Excel serial day 0

/** Accepts 'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', or an Excel serial
 *  number rendered as a string. Returns 'YYYY-MM-DD' or null. */
export function parseDatePart(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();

  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); // assume D/M/Y (port logs)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  if (/^\d+(\.\d+)?$/.test(t)) {                          // Excel serial
    const ms = EXCEL_EPOCH_MS + Number(t) * 86_400_000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

/** 'HH:MM' | 'HH:MM:SS' | Excel time fraction -> 'HH:MM:SS' or null. */
export function parseTimePart(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();

  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const hh = Number(m[1]), mm = Number(m[2]), ss = Number(m[3] ?? 0);
    if (hh > 23 || mm > 59 || ss > 59) return null;
    return [hh, mm, ss].map(n => String(n).padStart(2, '0')).join(':');
  }
  if (/^0?\.\d+$/.test(t)) {                              // Excel fraction of day
    const secs = Math.round(Number(t) * 86_400);
    const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
    return [hh, mm, ss].map(n => String(n).padStart(2, '0')).join(':');
  }
  return null;
}

/** Combine local date + time + explicit UTC offset into ISO 8601.
 *  Deliberately offset-based (not IANA) to stay dependency-free and
 *  unambiguous: '+05:30' for Mormugao, '+02:00' for all SA ports. */
export function toIso(
  datePart: string | null, timePart: string | null, utcOffset: string,
): string | null {
  if (!datePart) return null;
  if (!/^[+-]\d{2}:\d{2}$/.test(utcOffset)) return null;
  return `${datePart}T${timePart ?? '00:00:00'}${utcOffset}`;
}

/** 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD' (UTC-safe, no offset involved). */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function parseNum(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------
// 3. Domain classification
// ------------------------------------------------------------------

const CATEGORY_RULES: Array<[RegExp, VesselCategory]> = [
  [/CONTAINER/i, 'container'],
  [/TANKER|ACID|AMMONIA|EDIBLE OIL|POL|LPG|LNG|OIL/i, 'liquid_bulk'],
  [/BULK|ORE CARRIER|IRON ORE/i, 'dry_bulk'],
  [/TRANSHIPPER/i, 'transhipper'],
  [/NAVAL|NAVY|COAST GUARD|DEFENCE/i, 'naval_coastguard'],
  [/PASSANGER|PASSENGER|CASINO|CRUISE/i, 'passenger'],
  [/BARGE|CRAFT|TUG|DREDGER/i, 'barge_craft'],
  [/RESEARCH|SURVEY/i, 'research'],
  [/GENERAL CARGO/i, 'general_cargo'],
  [/BREAK\s?BULK/i, 'breakbulk'],
];

export function classifyVessel(vesselType: string | null): VesselCategory {
  if (!vesselType) return 'other';
  for (const [re, cat] of CATEGORY_RULES) if (re.test(vesselType)) return cat;
  return 'other';
}

export function inferMovementType(
  from: string, to: string, seaCodes: string[],
): MovementType | null {
  const sea = new Set(seaCodes.map(s => s.toUpperCase()));
  const f = sea.has(from.toUpperCase());
  const t = sea.has(to.toUpperCase());
  if (f && !t) return 'incoming';
  if (!f && t) return 'sailing';
  if (!f && !t) return 'shifting';
  return null; // SEA -> SEA is not a piloted port movement
}

// ------------------------------------------------------------------
// 4. Row -> movement; VCN group -> call
// ------------------------------------------------------------------

interface RowParse {
  vcn: string;
  vessel: ParsedVessel;
  purpose: string | null;
  ata: string | null;
  atb: string | null;
  atd: string | null;
  cargoRaw: string | null;
  draftFwdM: number | null;
  draftAftM: number | null;
  movement: ParsedMovement | null;
  berthTouched: string | null;   // non-sea location for primary-berth election
}

function parseOneRow(
  row: RawRow, rowIndex: number, utcOffset: string,
  seaCodes: string[], issues: ValidationIssue[],
): RowParse | null {
  const vcn = row.vcn?.trim() || null;
  const name = row.vesselName?.trim() || null;

  const err = (field: string, message: string) =>
    issues.push({ rowIndex, vcn, field, severity: 'error', message });
  const warn = (field: string, message: string) =>
    issues.push({ rowIndex, vcn, field, severity: 'warning', message });

  if (!vcn) { err('vcn', 'Missing VCN — row cannot be grouped into a call.'); return null; }
  if (!name) { err('vesselName', 'Missing vessel name.'); return null; }

  const ata = toIso(parseDatePart(row.arrivalDate), parseTimePart(row.arrivalTime), utcOffset);
  if (!ata) err('arrivalDate', 'Unparseable arrival date/time.');

  const atb = toIso(parseDatePart(row.berthDate), parseTimePart(row.berthTime), utcOffset);
  const atd = toIso(parseDatePart(row.unberthDate), parseTimePart(row.unberthTime), utcOffset);
  if (atb && atd && atd < atb)
    warn('unberthDate', 'Un-berth precedes berth time — kept, flag for review.');

  // Movement
  let movement: ParsedMovement | null = null;
  let berthTouched: string | null = null;
  const from = row.fromBerth?.trim().toUpperCase() || null;
  const to = row.toBerth?.trim().toUpperCase() || null;

  if (from && to) {
    const mType = inferMovementType(from, to, seaCodes);
    if (!mType) {
      warn('fromBerth', `SEA->SEA pair (${from}->${to}) is not a piloted movement — skipped.`);
    } else {
      const sea = new Set(seaCodes.map(s => s.toUpperCase()));
      berthTouched = !sea.has(to) ? to : (!sea.has(from) ? from : null);

      // Tug jobs: tug clock runs on the movement's date. The movement's
      // own timestamps come from berth date (incoming/shifting) or
      // un-berth date (sailing) — the closest anchor in this export.
      const anchorDate = mType === 'sailing'
        ? parseDatePart(row.unberthDate) ?? parseDatePart(row.berthDate)
        : parseDatePart(row.berthDate) ?? parseDatePart(row.arrivalDate);

      const tugJobs: ParsedTugJob[] = [];
      row.tugs.forEach((t, i) => {
        if (!t.name) {
          if (t.start || t.end)
            warn(`tug${i + 1}`, 'Tug times present but tug name missing — job skipped.');
          return;
        }
        const startAt = toIso(anchorDate, parseTimePart(t.start), utcOffset);
        let endAt = toIso(anchorDate, parseTimePart(t.end), utcOffset);
        if (startAt && endAt && endAt < startAt && anchorDate) {
          // Job rolled past midnight: push the END DATE forward one day.
          // Done on the date part (not via Date.toISOString) so the
          // result keeps the same explicit-offset format as every other
          // timestamp — lexical ordering of ISO strings stays valid.
          endAt = toIso(addDays(anchorDate, 1), parseTimePart(t.end), utcOffset);
          warn(`tug${i + 1}`, 'Tug end before start — interpreted as past-midnight rollover.');
        }
        tugJobs.push({ tugName: t.name.trim().toUpperCase(), tugOrder: i + 1, startAt, endAt });
      });

      movement = {
        movementType: mType,
        fromLocation: from,
        toLocation: to,
        startedAt: tugJobs[0]?.startAt ?? toIso(anchorDate, null, utcOffset),
        completedAt: tugJobs.length
          ? tugJobs.map(t => t.endAt).filter(Boolean).sort().at(-1) ?? null
          : null,
        pilotName: row.pilot?.trim() || null,
        tugJobs,
      };
    }
  } else {
    warn('fromBerth', 'Missing FROM/TO berth — call kept, movement skipped.');
  }

  return {
    vcn,
    vessel: {
      name: name.toUpperCase(),
      category: classifyVessel(row.vesselType),
      dwt: parseNum(row.dwt),
      grt: parseNum(row.grt),
      loaM: parseNum(row.loa),
    },
    purpose: row.purpose?.trim() || null,
    ata, atb, atd,
    cargoRaw: row.cargo?.trim() || null,
    draftFwdM: parseNum(row.draftFwd),
    draftAftM: parseNum(row.draftAft),
    movement,
    berthTouched,
  };
}

/** Main entry point. */
export function parseRawRows(
  rows: RawRow[],
  utcOffset: string,
  knownBerthCodes: string[],
  seaCodes: string[] = ['SEA'],
): { calls: ParsedCall[]; report: IngestReport } {
  const issues: ValidationIssue[] = [];
  const byVcn = new Map<string, RowParse[]>();
  let rejected = 0;

  rows.forEach((row, i) => {
    const p = parseOneRow(row, i, utcOffset, seaCodes, issues);
    if (!p) { rejected++; return; }
    const list = byVcn.get(p.vcn) ?? [];
    list.push(p);
    byVcn.set(p.vcn, list);
  });

  const known = new Set(knownBerthCodes.map(b => b.toUpperCase()));
  const sea = new Set(seaCodes.map(s => s.toUpperCase()));
  const unknownBerths = new Set<string>();
  const unmappedCargo = new Set<string>();
  const calls: ParsedCall[] = [];

  for (const [vcn, group] of byVcn) {
    // A call needs at least one row with a valid ATA.
    const withAta = group.filter(g => g.ata);
    if (withAta.length === 0) {
      issues.push({
        rowIndex: -1, vcn, field: 'ata', severity: 'error',
        message: 'No row in this VCN group has a valid arrival timestamp — call excluded.',
      });
      rejected += group.length;
      continue;
    }

    const ata = withAta.map(g => g.ata!).sort()[0];
    const atb = group.map(g => g.atb).filter(Boolean).sort()[0] ?? null;
    const atd = group.map(g => g.atd).filter((x): x is string => !!x).sort().at(-1) ?? null;

    const movements = group
      .map(g => g.movement)
      .filter((m): m is ParsedMovement => m !== null)
      .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));

    // Primary berth = first non-sea location touched by an incoming
    // movement, else first berth touched at all.
    const incoming = movements.find(m => m.movementType === 'incoming');
    const primaryBerthCode =
      incoming?.toLocation ??
      group.map(g => g.berthTouched).find(Boolean) ?? null;

    for (const g of group) {
      if (g.berthTouched && !known.has(g.berthTouched) && !sea.has(g.berthTouched))
        unknownBerths.add(g.berthTouched);
      if (g.cargoRaw) unmappedCargo.add(g.cargoRaw);
    }

    const first = withAta[0];
    calls.push({
      vcn,
      vessel: first.vessel,
      purpose: first.purpose,
      ata, atb, atd,
      primaryBerthCode,
      cargoRaw: group.map(g => g.cargoRaw).find(Boolean) ?? null,
      draftFwdM: first.draftFwdM,
      draftAftM: first.draftAftM,
      movements,
    });
  }

  const report: IngestReport = {
    rowsReceived: rows.length,
    callsParsed: calls.length,
    movementsParsed: calls.reduce((n, c) => n + c.movements.length, 0),
    tugJobsParsed: calls.reduce(
      (n, c) => n + c.movements.reduce((m, mv) => m + mv.tugJobs.length, 0), 0),
    rowsRejected: rejected,
    issues,
    unknownBerthCodes: [...unknownBerths].sort(),
    unmappedCargo: [...unmappedCargo].sort(),
  };

  return { calls, report };
}
