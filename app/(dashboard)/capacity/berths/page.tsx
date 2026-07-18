// app/(dashboard)/capacity/berths/page.tsx
'use client';

// Reads the /api/optimize snapshot for BOR + queueing, and layers an
// interactive M/M/c "what-if" panel on top: dragging lambda/mu/c re-runs
// the queueing formula client-side (imported directly — it's a pure
// function, no reason to round-trip the server for a slider).

import { useEffect, useMemo, useState } from 'react';
import { mmcQueue } from '@/lib/optimization/queueing';
import { usePortSession } from '@/lib/session/PortSessionContext';

interface Snapshot {
  period: { start: string; end: string; hours: number };
  bor: {
    borPercent: number;
    band: 'under_utilized' | 'healthy' | 'congested';
    perBerth: Array<{ berth: string; hours: number; borPercent: number }>;
  };
  queue: { rho: number; pWait: number; Lq: number; Wq: number; W: number; stable: boolean } | null;
  bottleneck: string;
  sampleSizes: { calls: number; serviceTimeSamples: number };
}

const BAND_STYLE: Record<Snapshot['bor']['band'], { label: string; className: string }> = {
  under_utilized: { label: 'Under-utilized', className: 'text-sky-400 bg-sky-950/40 border-sky-800/50' },
  healthy: { label: 'Healthy', className: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50' },
  congested: { label: 'Congested', className: 'text-red-400 bg-red-950/40 border-red-800/50' },
};

export default function BerthsCapacityPage() {
  const { portId, accessToken } = usePortSession();
  const [berthCount, setBerthCount] = useState(1);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // What-if sliders, seeded from the snapshot once it loads
  const [lambda, setLambda] = useState(0.5);   // arrivals/hour
  const [muHours, setMuHours] = useState(48);  // mean service time, hours
  const [c, setC] = useState(berthCount);

  // Date range — defaults to trailing 90 days, but fully overridable.
  // Needed for historical datasets (e.g. a 2017-2020 export) where
  // "today" has no relationship to when the data actually happened.
  const todayIso = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [periodStartInput, setPeriodStartInput] = useState(ninetyDaysAgoIso);
  const [periodEndInput, setPeriodEndInput] = useState(todayIso);

  useEffect(() => {
    if (!portId || !accessToken) return;
    fetch(`/api/settings/berths?portId=${portId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json())
      .then(d => setBerthCount(Math.max(1, (d.berths ?? []).filter((b: { is_anchorage: boolean }) => !b.is_anchorage).length)))
      .catch(() => {});
  }, [portId, accessToken]);

  const runQuery = () => {
    if (!portId || !accessToken || !periodStartInput || !periodEndInput) return;
    setLoading(true);
    setError(null);
    fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        portId,
        periodStart: new Date(periodStartInput).toISOString(),
        periodEnd: new Date(new Date(periodEndInput).getTime() + 86_400_000).toISOString(), // inclusive of end date
      }),
    })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then((data: Snapshot) => {
        setSnapshot(data);
        if (data.sampleSizes.calls > 0) setLambda(data.sampleSizes.calls / data.period.hours);
        if (data.sampleSizes.serviceTimeSamples > 0) {
          const totalOccupiedHours = data.bor.perBerth.reduce((a: number, b: { hours: number }) => a + b.hours, 0);
          setMuHours(totalOccupiedHours / data.sampleSizes.serviceTimeSamples);
        }
        setC(berthCount);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    runQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portId, accessToken, berthCount]);

  const whatIf = useMemo(() => {
    const mu = 1 / muHours;
    try { return mmcQueue({ lambda, mu, c }); }
    catch { return null; }
  }, [lambda, muHours, c]);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading capacity snapshot…</div>;
  if (error) return (
    <div className="m-6 rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  );
  if (!snapshot) return null;

  const band = BAND_STYLE[snapshot.bor.band];

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <h1 className="text-xl font-medium text-slate-100">Berth capacity</h1>
        <p className="mt-1 text-sm text-slate-400">
          {snapshot.sampleSizes.calls.toLocaleString()} calls ·{' '}
          {snapshot.sampleSizes.serviceTimeSamples.toLocaleString()} with complete berth/unberth times
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">From</span>
            <input
              type="date" value={periodStartInput}
              onChange={e => setPeriodStartInput(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">To</span>
            <input
              type="date" value={periodEndInput}
              onChange={e => setPeriodEndInput(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
            />
          </label>
          <button
            onClick={runQuery}
            className="rounded-md bg-[#3D9BC4] px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-[#5BAFD4]"
          >
            Apply
          </button>
        </div>
      </header>

      {/* --- Overall BOR gauge --- */}
      <section className="rounded-xl border border-slate-800 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-3xl font-medium text-slate-100">{snapshot.bor.borPercent.toFixed(1)}%</div>
            <div className="text-xs text-slate-500">Port-wide berth occupancy ratio</div>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${band.className}`}>
            {band.label}
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className={
              snapshot.bor.band === 'congested' ? 'h-full bg-red-500' :
              snapshot.bor.band === 'healthy' ? 'h-full bg-emerald-500' : 'h-full bg-sky-500'
            }
            style={{ width: `${Math.min(100, snapshot.bor.borPercent)}%` }}
          />
        </div>
        {snapshot.bottleneck !== 'none' && (
          <div className="mt-3 text-xs text-[#3D9BC4]">
            Current bottleneck signal: {snapshot.bottleneck.replace('_', ' ')}
          </div>
        )}
      </section>

      {/* --- Per-berth table --- */}
      <section className="rounded-xl border border-slate-800">
        <div className="border-b border-slate-800 px-5 py-3 text-sm font-medium text-slate-200">
          By berth
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="px-5 py-2 font-normal">Berth</th>
              <th className="px-5 py-2 font-normal">Occupied hours</th>
              <th className="px-5 py-2 font-normal">BOR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {snapshot.bor.perBerth
              .sort((a, b) => b.borPercent - a.borPercent)
              .map(row => (
                <tr key={row.berth}>
                  <td className="px-5 py-2 text-slate-300">{row.berth}</td>
                  <td className="px-5 py-2 text-slate-400">{row.hours.toFixed(0)}h</td>
                  <td className="px-5 py-2 text-slate-300">{row.borPercent.toFixed(1)}%</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      {/* --- Queueing snapshot --- */}
      {snapshot.queue?.stable && (
        <section className="grid grid-cols-3 gap-3">
          <Stat label="Avg wait (anchorage)" value={`${snapshot.queue.Wq.toFixed(1)}h`} />
          <Stat label="Avg queue length" value={snapshot.queue.Lq.toFixed(2)} />
          <Stat label="P(a vessel waits)" value={`${(snapshot.queue.pWait * 100).toFixed(0)}%`} />
        </section>
      )}
      {snapshot.queue && !snapshot.queue.stable && (
        <div className="rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          Arrival rate exceeds service capacity at current berth count — queue is theoretically unbounded.
          This needs immediate attention, not a slider.
        </div>
      )}

      {/* --- What-if panel --- */}
      <section className="rounded-xl border border-slate-800 p-5">
        <div className="mb-4 text-sm font-medium text-slate-200">
          What if… (M/M/c, adjust and see the effect instantly)
        </div>
        <div className="space-y-4">
          <SliderRow
            label="Arrivals per day" value={lambda * 24} min={0.1} max={20} step={0.1}
            display={(lambda * 24).toFixed(1)}
            onChange={v => setLambda(v / 24)}
          />
          <SliderRow
            label="Mean service time (hours)" value={muHours} min={4} max={120} step={1}
            display={muHours.toFixed(0)}
            onChange={setMuHours}
          />
          <SliderRow
            label="Berths available" value={c} min={1} max={Math.max(berthCount * 2, 4)} step={1}
            display={String(c)}
            onChange={v => setC(Math.round(v))}
          />
        </div>
        {whatIf && (
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-800 pt-4">
            {whatIf.stable ? (
              <>
                <Stat label="Utilization" value={`${(whatIf.rho * 100).toFixed(0)}%`} />
                <Stat label="Wait time" value={`${whatIf.Wq.toFixed(1)}h`} />
                <Stat label="Queue length" value={whatIf.Lq.toFixed(2)} />
              </>
            ) : (
              <div className="col-span-3 text-sm text-red-400">
                Unstable — this combination has no steady state. Add berths or reduce arrivals/service time.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="text-lg font-medium text-slate-100">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, display, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-medium text-slate-200">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[#3D9BC4]"
      />
    </div>
  );
}
