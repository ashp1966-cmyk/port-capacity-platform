// app/(dashboard)/data/upload/page.tsx
'use client';

// Vessel-call upload flow: pick file -> map columns -> dry-run validate ->
// review report -> commit. Talks to POST /api/ingest (dryRun then commit).
//
// Design note: three explicit steps rather than one big form, because a
// failed silent import is worse than a slow one — the person doing this
// is an AUK port operator, not a developer, and needs to see exactly what
// will happen before it happens.

import { useState, useCallback, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { normalizeRow } from '@/lib/ingest/parseRawData';
import type { IngestReport, RawRow } from '@/lib/ingest/types';
import { usePortSession } from '@/lib/session/PortSessionContext';

type Step = 'select' | 'mapping' | 'reviewing' | 'committing' | 'done';

function useEffectFetchBerthCodes(
  portId: string | null, accessToken: string, setKnownBerthCodes: (codes: string[]) => void,
) {
  useEffect(() => {
    if (!portId || !accessToken) return;
    fetch(`/api/settings/berths?portId=${portId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json())
      .then(d => setKnownBerthCodes((d.berths ?? []).map((b: { code: string }) => b.code)))
      .catch(() => {});
  }, [portId, accessToken, setKnownBerthCodes]);
}

interface SheetPreview {
  headers: string[];
  sampleRows: Record<string, unknown>[];
  allRecords: Record<string, unknown>[];
}

const REQUIRED_FIELDS = ['vcn', 'vesselName', 'arrivalDate'] as const;
const FIELD_LABELS: Record<string, string> = {
  vcn: 'Call number (VCN)', vesselType: 'Vessel type', vesselName: 'Vessel name',
  purpose: 'Purpose of visit', arrivalDate: 'Arrival date', arrivalTime: 'Arrival time',
  grt: 'GRT', dwt: 'DWT', cargo: 'Cargo', loa: 'LOA', draftFwd: 'Draft fwd', draftAft: 'Draft aft',
  fromBerth: 'From berth', toBerth: 'To berth', berthDate: 'Berth date', berthTime: 'Berth time',
  unberthDate: 'Un-berth date', unberthTime: 'Un-berth time', pilot: 'Pilot',
};

export default function UploadPage() {
  const { portId, accessToken, ports } = usePortSession();
  const targetPortName = ports.find(p => p.id === portId)?.name ?? 'Unknown port';
  const [utcOffset] = useState('+02:00'); // South African ports; adjust per port in Settings if needed
  const [knownBerthCodes, setKnownBerthCodes] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('select');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<SheetPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({}); // targetField -> sourceHeader
  const [report, setReport] = useState<IngestReport | null>(null);
  const [commitResult, setCommitResult] = useState<{
    calls: number; movements: number; tugJobs: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedIssues, setExpandedIssues] = useState(false);

  useEffectFetchBerthCodes(portId, accessToken, setKnownBerthCodes);

  // ---- Step 1: file select --------------------------------------------
  const onFile = useCallback(async (file: File) => {
    setError(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      const sheetName = wb.SheetNames.includes('RawData') ? 'RawData' : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
      if (records.length === 0) { setError('Sheet has no data rows.'); return; }
      const headers = Object.keys(records[0]);
      setPreview({ headers, sampleRows: records.slice(0, 5), allRecords: records });
      setMapping(autoMap(headers));
      setStep('mapping');
    } catch {
      setError('Could not read this file. Expected an .xlsx or .csv export.');
    }
  }, []);

  // ---- Step 2 -> 3: dry-run validate -----------------------------------
  const runValidation = useCallback(async () => {
    if (!preview) return;
    const missing = REQUIRED_FIELDS.filter(f => !mapping[f]);
    if (missing.length) {
      setError(`Map these fields before continuing: ${missing.map(f => FIELD_LABELS[f]).join(', ')}`);
      return;
    }
    setError(null);
    setStep('reviewing');

    const remapped = preview.allRecords.map(r => remapRecord(r, mapping));
    const rows: RawRow[] = remapped.map(normalizeRow);

    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ portId, utcOffset, dryRun: true, rows, knownBerthCodes }),
    });
    if (!res.ok) { setError(`Validation failed (${res.status}). Nothing was written.`); setStep('mapping'); return; }
    const { report } = await res.json();
    setReport(report as IngestReport);
  }, [preview, mapping, portId, utcOffset, knownBerthCodes, accessToken]);

  // ---- Step 3 -> commit --------------------------------------------------
  const commit = useCallback(async () => {
    if (!preview) return;
    setStep('committing');
    setError(null);
    const remapped = preview.allRecords.map(r => remapRecord(r, mapping));
    const rows: RawRow[] = remapped.map(normalizeRow);

    const res = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ portId, utcOffset, dryRun: false, rows, knownBerthCodes }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.error ?? `Import failed (${res.status}).`);
      setStep('reviewing');
      return;
    }
    const { committed } = await res.json();
    setCommitResult(committed);
    setStep('done');
  }, [preview, mapping, portId, utcOffset, knownBerthCodes, accessToken]);

  const reset = () => {
    setStep('select'); setFileName(null); setPreview(null);
    setMapping({}); setReport(null); setCommitResult(null); setError(null);
  };

  // ----------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-medium text-slate-100">Upload vessel calls</h1>
        <p className="mt-1 text-sm text-slate-400">
          Import a VTS export. Nothing is written until you confirm the validation report.
        </p>
      </header>

      <StepIndicator step={step} />

      {error && (
        <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {step === 'select' && (
        <label
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-900/40 px-6 py-16 text-center transition hover:border-amber-500/60"
        >
          <span className="text-sm font-medium text-slate-200">Drop a .xlsx or .csv file, or click to browse</span>
          <span className="mt-1 text-xs text-slate-500">Column headers can vary — you'll map them next</span>
          <input
            type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      )}

      {step === 'mapping' && preview && (
        <div className="space-y-5">
          <div className="text-sm text-slate-400">
            {fileName} — {preview.allRecords.length.toLocaleString()} rows detected
          </div>
          <div className="rounded-xl border border-slate-800 divide-y divide-slate-800">
            {Object.entries(FIELD_LABELS).map(([field, label]) => (
              <div key={field} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className="text-sm text-slate-300">
                  {label}
                  {(REQUIRED_FIELDS as readonly string[]).includes(field) && (
                    <span className="ml-1 text-amber-500">*</span>
                  )}
                </span>
                <select
                  className="w-56 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
                  value={mapping[field] ?? ''}
                  onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}
                >
                  <option value="">— not present —</option>
                  {preview.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
            <div className="px-4 py-2.5 text-xs text-slate-500">
              Tug columns (Tug1..Tug4, start/end times) are detected automatically by header pattern.
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={reset} className="rounded-md px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
              Start over
            </button>
            <button
              onClick={runValidation}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-400"
            >
              Validate
            </button>
          </div>
        </div>
      )}

      {step === 'reviewing' && !report && (
        <div className="py-16 text-center text-sm text-slate-400">Validating…</div>
      )}

      {step === 'reviewing' && report && (
        <ValidationReport
          report={report}
          targetPortName={targetPortName}
          expandedIssues={expandedIssues}
          onToggleIssues={() => setExpandedIssues(v => !v)}
          onBack={() => { setStep('mapping'); setReport(null); }}
          onCommit={commit}
        />
      )}

      {step === 'committing' && (
        <div className="py-16 text-center text-sm text-slate-400">Writing to the database…</div>
      )}

      {step === 'done' && commitResult && (
        <div className="space-y-4 rounded-xl border border-emerald-800/50 bg-emerald-950/30 px-6 py-8 text-center">
          <p className="text-base font-medium text-emerald-300">Import complete</p>
          <p className="text-sm text-slate-300">
            {commitResult.calls.toLocaleString()} calls · {commitResult.movements.toLocaleString()} movements ·{' '}
            {commitResult.tugJobs.toLocaleString()} tug jobs written.
          </p>
          <button onClick={reset} className="rounded-md bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">
            Upload another file
          </button>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
function StepIndicator({ step }: { step: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'select', label: 'Select file' },
    { key: 'mapping', label: 'Map columns' },
    { key: 'reviewing', label: 'Review' },
    { key: 'done', label: 'Committed' },
  ];
  const activeIdx = steps.findIndex(s =>
    s.key === step || (s.key === 'reviewing' && step === 'committing'));
  return (
    <ol className="flex items-center gap-2 text-xs text-slate-500">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className={
            i <= activeIdx ? 'font-medium text-amber-500' : 'text-slate-600'
          }>{s.label}</span>
          {i < steps.length - 1 && <span className="text-slate-700">→</span>}
        </li>
      ))}
    </ol>
  );
}

function ValidationReport({
  report, targetPortName, expandedIssues, onToggleIssues, onBack, onCommit,
}: {
  report: IngestReport;
  targetPortName: string;
  expandedIssues: boolean;
  onToggleIssues: () => void;
  onBack: () => void;
  onCommit: () => void;
}) {
  const errorCount = report.issues.filter(i => i.severity === 'error').length;
  const warningCount = report.issues.filter(i => i.severity === 'warning').length;
  const shown = expandedIssues ? report.issues : report.issues.slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border-2 border-amber-500 bg-amber-950/30 px-4 py-3 text-center text-sm font-medium text-amber-200">
        This will commit to: <span className="text-amber-400">{targetPortName}</span>
        <div className="mt-1 text-xs font-normal text-amber-300/80">
          Wrong port? Switch it in the selector above before continuing — reloading this page will lose your progress.
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Calls parsed" value={report.callsParsed} />
        <Stat label="Movements" value={report.movementsParsed} />
        <Stat label="Tug jobs" value={report.tugJobsParsed} />
        <Stat label="Rows rejected" value={report.rowsRejected} tone={report.rowsRejected ? 'warn' : 'ok'} />
      </div>

      {report.unknownBerthCodes.length > 0 && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
          Unrecognized berth codes: {report.unknownBerthCodes.join(', ')}. These calls will import without a
          linked berth — add them in Settings → Berths first if that's not intended.
        </div>
      )}
      {report.unmappedCargo.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-300">
          {report.unmappedCargo.length} distinct cargo descriptions have no commodity mapping yet. They'll
          import as free text and can be mapped afterward in Settings → Commodities.
        </div>
      )}

      {report.issues.length > 0 && (
        <div className="rounded-xl border border-slate-800">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs text-slate-400">
            <span>{errorCount} errors · {warningCount} warnings</span>
            {report.issues.length > 8 && (
              <button onClick={onToggleIssues} className="text-amber-500 hover:underline">
                {expandedIssues ? 'Show less' : `Show all ${report.issues.length}`}
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-800">
            {shown.map((issue, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-2 text-xs">
                <span className={
                  issue.severity === 'error'
                    ? 'mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-medium text-red-300 bg-red-950/50'
                    : 'mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-medium text-amber-300 bg-amber-950/50'
                }>{issue.severity}</span>
                <span className="text-slate-400">
                  Row {issue.rowIndex + 1}{issue.vcn ? ` (${issue.vcn})` : ''} — {issue.field}: {issue.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="rounded-md px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
          Back to mapping
        </button>
        <button
          onClick={onCommit}
          disabled={report.callsParsed === 0}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-400 disabled:opacity-40"
        >
          Commit {report.callsParsed.toLocaleString()} calls
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'ok' | 'warn' }) {
  const color = tone === 'warn' && value > 0 ? 'text-amber-400' : tone === 'ok' ? 'text-emerald-400' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className={`text-lg font-medium ${color}`}>{value.toLocaleString()}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Best-effort auto-mapping so the common case (headers matching the
// 2020 MPT RawData sheet, or a close variant) needs zero manual clicks.
function autoMap(headers: string[]): Record<string, string> {
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
  const table: Record<string, string[]> = {
    vcn: ['VCN'], vesselType: ['VESSEL TYPE'], vesselName: ['VESSEL NAME'],
    purpose: ['PUPOSE OF VISIT', 'PURPOSE OF VISIT'],
    arrivalDate: ['ARRIVAL DATE'], arrivalTime: ['ARRIVAL TIME'],
    grt: ['GRT'], dwt: ['DWT'], cargo: ['CARGO'], loa: ['LOA'],
    draftFwd: ['FWD'], draftAft: ['AFT'],
    fromBerth: ['FROM BERTH'], toBerth: ['TO BERTH'],
    berthDate: ['BERTH DT', 'BERTH DATE'], berthTime: ['BERTH TM', 'BERTH TIME'],
    unberthDate: ['UN-BERTH DT', 'UN-BERTH DATE'], unberthTime: ['UN-BERTH TM', 'UN-BERTH TIME'],
    pilot: ['PILOT'],
  };
  const out: Record<string, string> = {};
  for (const [field, candidates] of Object.entries(table)) {
    const hit = headers.find(h => candidates.includes(norm(h)));
    if (hit) out[field] = hit;
  }
  return out;
}

// Rewrites a raw spreadsheet record's keys to the canonical headers that
// normalizeRow() expects, based on the user's confirmed mapping, then
// passes tug columns through untouched (they're matched by regex in
// normalizeRow itself and aren't part of the manual mapping UI).
function remapRecord(record: Record<string, unknown>, mapping: Record<string, string>) {
  const CANONICAL: Record<string, string> = {
    vcn: 'VCN', vesselType: 'VESSEL TYPE', vesselName: 'VESSEL NAME', purpose: 'PUPOSE OF VISIT',
    arrivalDate: 'Arrival Date', arrivalTime: 'Arrival Time', grt: 'GRT', dwt: 'DWT',
    cargo: 'CARGO', loa: 'LOA', draftFwd: 'FWD', draftAft: 'AFT',
    fromBerth: 'FROM BERTH', toBerth: 'TO BERTH', berthDate: 'Berth Dt', berthTime: 'Berth Tm',
    unberthDate: 'Un-Berth Dt', unberthTime: 'Un-Berth Tm', pilot: 'PILOT',
  };
  const out: Record<string, unknown> = { ...record }; // keep TUG* columns as-is
  for (const [field, sourceHeader] of Object.entries(mapping)) {
    if (sourceHeader) out[CANONICAL[field]] = record[sourceHeader];
  }
  return out;
}
