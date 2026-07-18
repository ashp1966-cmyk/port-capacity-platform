// app/(dashboard)/projections/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePortSession } from '@/lib/session/PortSessionContext';

interface RunSummary {
  id: string;
  model: string;
  horizon_months: number;
  created_at: string;
  forecast_count?: number;
}

export default function ProjectionsPage() {
  const { portId, accessToken } = usePortSession();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [horizon, setHorizon] = useState<12 | 24 | 36>(24);

  const loadRuns = async () => {
    const res = await fetch(`/api/forecast/runs?portId=${portId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) setRuns((await res.json()).runs);
  };

  useEffect(() => { loadRuns(); /* eslint-disable-next-line */ }, [portId]);

  const createRun = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ portId, horizonMonths: horizon }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? `Failed (${res.status})`); return; }
      await loadRuns();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium text-slate-100">Cargo projections</h1>
          <p className="mt-1 text-sm text-slate-400">
            Statistical baseline adjusted by Claude with current market context
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-slate-800 p-5">
        <div className="mb-3 text-sm font-medium text-slate-200">New projection</div>
        <div className="flex items-center gap-3">
          <select
            value={horizon}
            onChange={e => setHorizon(Number(e.target.value) as 12 | 24 | 36)}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
          >
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
            <option value={36}>36 months</option>
          </select>
          <button
            onClick={createRun}
            disabled={creating}
            className="rounded-md bg-[#3D9BC4] px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-[#5BAFD4] disabled:opacity-50"
          >
            {creating ? 'Running…' : 'Run projection'}
          </button>
        </div>
        {creating && (
          <p className="mt-2 text-xs text-slate-500">
            Claude is checking current market conditions — this can take up to a minute.
          </p>
        )}
        {error && (
          <div className="mt-3 rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-800">
        <div className="border-b border-slate-800 px-5 py-3 text-sm font-medium text-slate-200">
          Past runs
        </div>
        {!runs ? (
          <div className="px-5 py-6 text-sm text-slate-500">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">No projections yet — run one above.</div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {runs.map(run => (
              <li key={run.id}>
                <Link
                  href={`/projections/${run.id}`}
                  className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-900/40"
                >
                  <span className="text-slate-200">
                    {run.horizon_months}-month projection
                    {typeof run.forecast_count === 'number' ? ` · ${run.forecast_count} scenarios` : ''}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(run.created_at).toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
