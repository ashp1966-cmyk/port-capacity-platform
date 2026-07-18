// app/(dashboard)/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePortSession } from '@/lib/session/PortSessionContext';

interface Snapshot {
  bor: { borPercent: number; band: string };
  queue: { Wq: number; stable: boolean } | null;
  tug: { utilization: number } | null;
  bottleneck: string;
}

export default function DashboardHome() {
  const { portId, accessToken } = usePortSession();
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    if (!portId || !accessToken) return;
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - 30 * 86_400_000);
    fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        portId, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(),
      }),
    }).then(r => r.ok ? r.json() : null).then(setSnap).catch(() => {});
  }, [portId, accessToken]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-medium text-slate-100">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-400">Trailing 30 days</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Berth occupancy" value={snap ? `${snap.bor.borPercent.toFixed(1)}%` : '—'} href="/capacity/berths" />
        <KpiCard label="Avg wait" value={snap?.queue?.stable ? `${snap.queue.Wq.toFixed(1)}h` : '—'} href="/capacity/berths" />
        <KpiCard label="Tug utilization" value={snap?.tug ? `${(snap.tug.utilization * 100).toFixed(0)}%` : '—'} href="/capacity/tugs" />
      </div>

      {snap?.bottleneck && snap.bottleneck !== 'none' && (
        <div className="rounded-lg border border-[#3D9BC4]/30 bg-[#3D9BC4]/10 px-4 py-3 text-sm text-[#8EC5DC]">
          Current bottleneck signal: {snap.bottleneck.replace('_', ' ')}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/data/upload" className="rounded-xl border border-slate-800 p-5 hover:border-slate-600">
          <div className="text-sm font-medium text-slate-200">Upload vessel calls</div>
          <div className="mt-1 text-xs text-slate-500">Import a VTS export</div>
        </Link>
        <Link href="/projections" className="rounded-xl border border-slate-800 p-5 hover:border-slate-600">
          <div className="text-sm font-medium text-slate-200">Run a cargo projection</div>
          <div className="mt-1 text-xs text-slate-500">Claude-adjusted 12/24/36-month scenarios</div>
        </Link>
      </div>
    </div>
  );
}

function KpiCard({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link href={href} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 hover:border-slate-600">
      <div className="text-2xl font-medium text-slate-100">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{label}</div>
    </Link>
  );
}
