// app/(dashboard)/capacity/tugs/page.tsx
'use client';

// Tug fleet dashboard: required vs available hours (the engine formalized
// from your 2020 MPT Algorithm sheet), plus a live allocation-rule tester
// so an operator can check "how many tugs does a 90,000 DWT vessel at
// 13m draft need" without reading the rules table.

import { useEffect, useState } from 'react';
import { tugsForVessel, DEFAULT_ALLOCATION_RULES, type AllocationRule } from '@/lib/optimization/tugs';
import { usePortSession } from '@/lib/session/PortSessionContext';

interface TugSnapshot {
  requiredHours: number;
  availableHours: number;
  utilization: number;
  headroomHours: number;
  additionalTugsNeeded: number;
}

export default function TugsCapacityPage({
  allocationRules = DEFAULT_ALLOCATION_RULES,
}: { allocationRules?: AllocationRule[] }) {
  const { portId, accessToken } = usePortSession();
  const [tug, setTug] = useState<TugSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Allocation-rule tester inputs
  const [testDwt, setTestDwt] = useState(90000);
  const [testDraft, setTestDraft] = useState(13);

  const todayIso = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [periodStartInput, setPeriodStartInput] = useState(ninetyDaysAgoIso);
  const [periodEndInput, setPeriodEndInput] = useState(todayIso);

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
        periodEnd: new Date(new Date(periodEndInput).getTime() + 86_400_000).toISOString(),
      }),
    })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
        return res.json();
      })
      .then(data => setTug(data.tug))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    runQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portId, accessToken]);

  const testResult = tugsForVessel(testDwt, testDraft, allocationRules);

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading tug fleet snapshot…</div>;
  if (error) return (
    <div className="m-6 rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
      {error}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <h1 className="text-xl font-medium text-slate-100">Tug fleet capacity</h1>
        <p className="mt-1 text-sm text-slate-400">
          Annualized from the selected period's movement + tug-job data
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
            className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-amber-400"
          >
            Apply
          </button>
        </div>
      </header>

      {!tug ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
          No tug availability assumptions configured for this port yet — add fleet size and deduction
          hours in Settings → Tugs to see the utilization gauge.
        </div>
      ) : (
        <section className="rounded-xl border border-slate-800 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-medium text-slate-100">{(tug.utilization * 100).toFixed(1)}%</div>
              <div className="text-xs text-slate-500">Fleet utilization (required / available)</div>
            </div>
            {tug.additionalTugsNeeded > 0 ? (
              <span className="rounded-full border border-red-800/50 bg-red-950/40 px-3 py-1 text-xs font-medium text-red-400">
                {tug.additionalTugsNeeded} more tug{tug.additionalTugsNeeded > 1 ? 's' : ''} needed
              </span>
            ) : (
              <span className="rounded-full border border-emerald-800/50 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-400">
                Adequate headroom
              </span>
            )}
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={tug.utilization > 1 ? 'h-full bg-red-500' : tug.utilization > 0.85 ? 'h-full bg-amber-500' : 'h-full bg-emerald-500'}
              style={{ width: `${Math.min(100, tug.utilization * 100)}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Stat label="Hours required / yr" value={tug.requiredHours.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <Stat label="Hours available / yr" value={tug.availableHours.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <Stat
              label="Headroom"
              value={tug.headroomHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              tone={tug.headroomHours < 0 ? 'warn' : 'ok'}
            />
          </div>
        </section>
      )}

      {/* --- Allocation rule tester --- */}
      <section className="rounded-xl border border-slate-800 p-5">
        <div className="mb-4 text-sm font-medium text-slate-200">Allocation rule tester</div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Vessel DWT</span>
            <input
              type="number" value={testDwt} min={0} step={1000}
              onChange={e => setTestDwt(Number(e.target.value))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">Draft (m)</span>
            <input
              type="number" value={testDraft} min={0} step={0.1}
              onChange={e => setTestDraft(Number(e.target.value))}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
            />
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
          <div className="text-lg font-medium text-slate-100">
            {testResult.tugs} tug{testResult.tugs > 1 ? 's' : ''} required
            {testResult.minBollardT ? ` · min ${testResult.minBollardT}t bollard pull` : ''}
          </div>
          {testResult.matchedRule?.note && (
            <div className="mt-1 text-xs text-slate-500">{testResult.matchedRule.note}</div>
          )}
        </div>

        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="mb-2 text-xs font-medium text-slate-400">Active rules (evaluated in order)</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 font-normal">Priority</th>
                <th className="py-1 font-normal">Condition</th>
                <th className="py-1 font-normal">Tugs</th>
                <th className="py-1 font-normal">Min bollard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {allocationRules
                .slice().sort((a, b) => a.priority - b.priority)
                .map(r => (
                  <tr key={r.priority}>
                    <td className="py-1.5 text-slate-400">{r.priority}</td>
                    <td className="py-1.5 text-slate-300">
                      {[
                        r.minDraftM !== undefined ? `draft ≥ ${r.minDraftM}m` : null,
                        r.minDwt !== undefined ? `DWT ≥ ${r.minDwt.toLocaleString()}` : null,
                        r.maxDwt !== undefined ? `DWT ≤ ${r.maxDwt.toLocaleString()}` : null,
                      ].filter(Boolean).join(' and ')}
                    </td>
                    <td className="py-1.5 text-slate-300">{r.tugsRequired}</td>
                    <td className="py-1.5 text-slate-300">{r.minBollardT ? `${r.minBollardT}t` : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'ok' | 'warn' }) {
  const color = tone === 'warn' ? 'text-red-400' : tone === 'ok' ? 'text-emerald-400' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className={`text-base font-medium ${color}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
