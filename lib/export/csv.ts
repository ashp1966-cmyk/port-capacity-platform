// lib/export/csv.ts
// Pure, dependency-free CSV serialization — RFC 4180 quoting (fields
// containing a comma, quote, or newline get wrapped and internal quotes
// doubled). No library needed for this; pulling in a CSV writer for
// "join strings with commas, safely" would be the wrong tradeoff here.

export function toCsv<T extends object>(
  rows: T[], columns: Array<{ key: keyof T; header: string }>,
): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map(c => escape(c.header)).join(',');
  const body = rows
    .map(row => columns.map(c => escape(row[c.key])).join(','))
    .join('\r\n');
  return `${header}\r\n${body}`;
}

// ---- Domain-specific exports -------------------------------------------

export interface VesselCallExportRow {
  vcn: string;
  vessel_name: string;
  category: string;
  ata: string;
  atb: string | null;
  atd: string | null;
  berth: string | null;
  commodity: string | null;
  direction: string | null;
  cargo_volume_t: number | null;
  dwt: number | null;
  loa_m: number | null;
}

export function vesselCallsToCsv(rows: VesselCallExportRow[]): string {
  return toCsv(rows, [
    { key: 'vcn', header: 'VCN' },
    { key: 'vessel_name', header: 'Vessel name' },
    { key: 'category', header: 'Category' },
    { key: 'ata', header: 'ATA' },
    { key: 'atb', header: 'ATB' },
    { key: 'atd', header: 'ATD' },
    { key: 'berth', header: 'Berth' },
    { key: 'commodity', header: 'Commodity' },
    { key: 'direction', header: 'Direction' },
    { key: 'cargo_volume_t', header: 'Cargo volume (t)' },
    { key: 'dwt', header: 'DWT' },
    { key: 'loa_m', header: 'LOA (m)' },
  ]);
}

export interface ForecastExportRow {
  commodity: string;
  direction: string;
  scenario: string;
  period_start: string;
  volume: number;
  rationale: string;
}

export function forecastsToCsv(rows: ForecastExportRow[]): string {
  return toCsv(rows, [
    { key: 'commodity', header: 'Commodity' },
    { key: 'direction', header: 'Direction' },
    { key: 'scenario', header: 'Scenario' },
    { key: 'period_start', header: 'Period' },
    { key: 'volume', header: 'Volume' },
    { key: 'rationale', header: 'Rationale' },
  ]);
}
