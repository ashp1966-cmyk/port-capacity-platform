// app/(dashboard)/projections/[runId]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { usePortSession } from '@/lib/session/PortSessionContext';

interface ForecastRow {
  commodity: string;
  direction: 'import' | 'export';
  scenario: 'optimistic' | 'baseline' | 'conservative';
  period_start: string;
  volume: number;
  rationale: string;
}

const SCENARIO_COLOR: Record<ForecastRow['scenario'], string> = {
  optimistic: '#5DCAA5',   // teal
  baseline: '#3D9BC4',     // AUK Blue
  conservative: '#F09595', // red-200 (muted, not alarming)
};

export default function ForecastRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { accessToken } = usePortSession();
  const [rows, setRows] = useState<ForecastRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCommodity, setSelectedCommodity] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/forecast/runs/${runId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        setRows(data.forecasts);
        if (data.forecasts?.length) setSelectedCommodity(data.forecasts[0].commodity);
      })
      .catch(e => setError(e.message));
  }, [runId, accessToken]);

  const commodities = useMemo(
    () => [...new Set((rows ?? []).map(r => r.commodity))].sort(),
    [rows],
  );

  const chartData = useMemo(() => {
    if (!rows || !selectedCommodity) return [];
    const filtered = rows.filter(r => r.commodity === selectedCommodity);
    const years = [...new Set(filtered.map(r => r.period_start.slice(0, 4)))].sort();
    return years.map(year => {
      const point: Record<string, string | number> = { year };
      for (const scenario of ['optimistic', 'baseline', 'conservative'] as const) {
        const match = filtered.find(r => r.period_start.startsWith(year) && r.scenario === scenario);
        if (match) point[scenario] = Math.round(match.volume);
      }
      return point;
    });
  }, [rows, selectedCommodity]);

  const rationales = useMemo(
    () => (rows ?? []).filter(r => r.commodity === selectedCommodity),
    [rows, selectedCommodity],
  );

  if (error) return (
    <div className="m-6 rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  );
  if (!rows) return <div className="p-6 text-sm text-slate-400">Loading projection…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-medium text-slate-100">Projection detail</h1>
        <p className="mt-1 text-sm text-slate-400">
          Three scenarios per commodity, adjusted from the statistical baseline
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {commodities.map(c => (
          <button
            key={c}
            onClick={() => setSelectedCommodity(c)}
            className={
              c === selectedCommodity
                ? 'rounded-full bg-[#3D9BC4] px-3 py-1 text-xs font-medium text-slate-950'
                : 'rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 hover:border-slate-500'
            }
          >
            {c}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-slate-800 p-5">
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2c2c2a" />
              <XAxis dataKey="year" stroke="#888780" fontSize={12} />
              <YAxis stroke="#888780" fontSize={12} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: '#1a1a18', border: '1px solid #444441', fontSize: 12 }}
                formatter={(v) => (typeof v === 'number' ? v.toLocaleString() : v)}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="optimistic" stroke={SCENARIO_COLOR.optimistic} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="baseline" stroke={SCENARIO_COLOR.baseline} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="conservative" stroke={SCENARIO_COLOR.conservative} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800">
        <div className="border-b border-slate-800 px-5 py-3 text-sm font-medium text-slate-200">
          Rationale — {selectedCommodity}
        </div>
        <div className="divide-y divide-slate-800">
          {(['optimistic', 'baseline', 'conservative'] as const).map(scenario => {
            const r = rationales.find(x => x.scenario === scenario);
            if (!r) return null;
            return (
              <div key={scenario} className="px-5 py-3">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                  <span className="h-2 w-2 rounded-full" style={{ background: SCENARIO_COLOR[scenario] }} />
                  <span className="capitalize text-slate-300">{scenario}</span>
                </div>
                <p className="text-sm text-slate-400">{r.rationale}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
