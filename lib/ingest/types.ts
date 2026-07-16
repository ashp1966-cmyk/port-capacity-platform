// lib/ingest/types.ts
// Shared contracts for the VTS-export ingestion pipeline.
// Column names mirror the 2020 MPT RawData layout (including the
// 'PUPOSE OF VISIT' header typo, which the normalizer handles).

/** One raw row exactly as it comes out of the spreadsheet/CSV,
 *  after header normalization. All values are strings or null;
 *  parsing/typing happens in parseRawData.ts. */
export interface RawRow {
  vcn: string | null;
  vesselType: string | null;
  vesselName: string | null;
  purpose: string | null;
  arrivalDate: string | null;   // 'YYYY-MM-DD' or spreadsheet serial as string
  arrivalTime: string | null;   // 'HH:MM' | 'HH:MM:SS'
  grt: string | null;
  dwt: string | null;
  cargo: string | null;
  loa: string | null;
  draftFwd: string | null;
  draftAft: string | null;
  fromBerth: string | null;
  toBerth: string | null;
  berthDate: string | null;
  berthTime: string | null;
  unberthDate: string | null;
  unberthTime: string | null;
  pilot: string | null;
  tugs: Array<{
    name: string | null;
    start: string | null;       // 'HH:MM' on the movement date (may roll past midnight)
    end: string | null;
  }>;                           // length 0..4
}

export type MovementType = 'incoming' | 'sailing' | 'shifting';

export type VesselCategory =
  | 'dry_bulk' | 'liquid_bulk' | 'container' | 'breakbulk'
  | 'general_cargo' | 'transhipper' | 'passenger' | 'naval_coastguard'
  | 'barge_craft' | 'research' | 'other';

export interface ParsedVessel {
  name: string;
  category: VesselCategory;
  dwt: number | null;
  grt: number | null;
  loaM: number | null;
}

export interface ParsedTugJob {
  tugName: string;
  tugOrder: number;             // 1..4
  startAt: string | null;       // ISO 8601 with explicit offset
  endAt: string | null;
}

export interface ParsedMovement {
  movementType: MovementType;
  fromLocation: string;
  toLocation: string;
  startedAt: string | null;     // ISO 8601
  completedAt: string | null;
  pilotName: string | null;
  tugJobs: ParsedTugJob[];
}

export interface ParsedCall {
  vcn: string;
  vessel: ParsedVessel;
  purpose: string | null;
  ata: string;                  // ISO 8601 — required
  atb: string | null;
  atd: string | null;
  primaryBerthCode: string | null;
  cargoRaw: string | null;      // canonical commodity mapping happens server-side
  draftFwdM: number | null;
  draftAftM: number | null;
  movements: ParsedMovement[];
}

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  rowIndex: number;             // 0-based index into the submitted rows
  vcn: string | null;
  field: string;
  severity: IssueSeverity;      // error => row excluded; warning => row kept
  message: string;
}

export interface IngestReport {
  rowsReceived: number;
  callsParsed: number;
  movementsParsed: number;
  tugJobsParsed: number;
  rowsRejected: number;
  issues: ValidationIssue[];
  /** Distinct berth codes seen that are not in the port's berth register.
   *  Surfaced so an Editor can confirm or map them before commit. */
  unknownBerthCodes: string[];
  /** Distinct raw cargo strings needing commodity mapping. */
  unmappedCargo: string[];
}

export interface IngestRequest {
  portId: string;
  /** IANA-agnostic explicit UTC offset for the port's local clock,
   *  e.g. '+05:30' (Mormugao), '+02:00' (Durban). Applied to every
   *  date+time pair in the file. */
  utcOffset: string;
  /** true = validate only, return the report, write nothing. */
  dryRun: boolean;
  rows: RawRow[];
  /** Berth codes registered for this port (client fetches and passes,
   *  so the parser stays pure). Codes treated as sea/anchorage. */
  knownBerthCodes: string[];
  seaCodes?: string[];          // default ['SEA']
}
