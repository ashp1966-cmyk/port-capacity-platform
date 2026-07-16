// app/api/optimize/route.ts
// POST /api/optimize  { portId, periodStart, periodEnd, yardUtilization?, evacuationRatio? }
//
// Aggregates raw operational data (calls, movements, tug jobs) into the
// inputs the pure functions in lib/optimization/ need, runs them, and
// returns one consolidated capacity snapshot for the /capacity screens.
// All arithmetic happens in lib/optimization — this route only shapes data.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { berthOccupancyRatio } from '@/lib/optimization/bor';
import { mgcQueue, serviceTimeCV } from '@/lib/optimization/queueing';
import { tugCapacity, type TugMovementStats } from '@/lib/optimization/tugs';
import { classifyBottleneck } from '@/lib/optimization/bottleneck';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

interface OptimizeRequest {
  portId: string;
  periodStart: string;   // ISO date, inclusive
  periodEnd: string;     // ISO date, exclusive
  yardUtilization?: number;   // 0..1, from an external WMS — optional
  evacuationRatio?: number;   // 0..1, from an external WMS — optional
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as OptimizeRequest;
  if (!body.portId || !body.periodStart || !body.periodEnd)
    return NextResponse.json({ error: 'portId, periodStart, periodEnd are required' }, { status: 400 });

  const db = admin();
  const periodHours =
    (new Date(body.periodEnd).getTime() - new Date(body.periodStart).getTime()) / 3_600_000;
  if (!(periodHours > 0))
    return NextResponse.json({ error: 'periodEnd must be after periodStart' }, { status: 400 });

  // ---- 1. Berths + occupied hours --------------------------------------
  const { data: berths, error: bErr } = await db
    .from('berths').select('id, code').eq('port_id', body.portId).eq('is_anchorage', false);
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  if (!berths?.length)
    return NextResponse.json({ error: 'Port has no registered berths' }, { status: 422 });

  const { data: calls, error: cErr } = await db
    .from('vessel_calls')
    .select('id, primary_berth_id, atb, atd')
    .eq('port_id', body.portId)
    .gte('atb', body.periodStart).lt('atb', body.periodEnd)
    .not('atb', 'is', null).not('atd', 'is', null);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const berthCodeById = new Map((berths ?? []).map(b => [b.id, b.code]));
  const occupiedHoursPerBerth: Record<string, number> = {};
  const serviceHoursSamples: number[] = [];

  for (const c of calls ?? []) {
    if (!c.primary_berth_id || !c.atb || !c.atd) continue;
    const code = berthCodeById.get(c.primary_berth_id);
    if (!code) continue;
    const hours = (new Date(c.atd).getTime() - new Date(c.atb).getTime()) / 3_600_000;
    if (hours <= 0) continue; // guards bad data (unberth before berth), logged separately at ingest
    occupiedHoursPerBerth[code] = (occupiedHoursPerBerth[code] ?? 0) + hours;
    serviceHoursSamples.push(hours);
  }

  const bor = berthOccupancyRatio({
    occupiedHoursPerBerth, berthCount: berths.length, periodHours,
  });

  // ---- 2. Queueing (M/G/c) ----------------------------------------------
  const arrivals = calls?.length ?? 0;
  const lambda = arrivals / periodHours;
  const meanServiceHours =
    serviceHoursSamples.length
      ? serviceHoursSamples.reduce((a, b) => a + b, 0) / serviceHoursSamples.length
      : null;
  const mu = meanServiceHours ? 1 / meanServiceHours : null;
  const cv = serviceTimeCV(serviceHoursSamples);

  const queue = lambda > 0 && mu
    ? mgcQueue({ lambda, mu, c: berths.length, serviceTimeCV: cv })
    : null;

  // ---- 3. Tug capacity ---------------------------------------------------
  const { data: movements } = await db
    .from('movements')
    .select('movement_type, started_at, call_id, vessel_calls!inner(port_id, atb)')
    .eq('vessel_calls.port_id', body.portId)
    .gte('vessel_calls.atb', body.periodStart).lt('vessel_calls.atb', body.periodEnd);

  const { data: tugJobs } = await db
    .from('movement_tugs')
    .select('movement_id, start_at, end_at, movements!inner(movement_type, call_id, vessel_calls!inner(port_id, atb))')
    .eq('movements.vessel_calls.port_id', body.portId)
    .gte('movements.vessel_calls.atb', body.periodStart).lt('movements.vessel_calls.atb', body.periodEnd);

  const hoursByType: Record<string, number[]> = { incoming: [], sailing: [], shifting: [] };
  for (const t of tugJobs ?? []) {
    if (!t.start_at || !t.end_at) continue;
    const mv = (t as any).movements;
    const type = mv?.movement_type as string | undefined;
    if (!type || !(type in hoursByType)) continue;
    const h = (new Date(t.end_at).getTime() - new Date(t.start_at).getTime()) / 3_600_000;
    if (h > 0) hoursByType[type].push(h);
  }
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const countByType: Record<string, number> = { incoming: 0, sailing: 0, shifting: 0 };
  for (const m of movements ?? []) {
    if (m.movement_type in countByType) countByType[m.movement_type] += 1;
  }
  // Extrapolate the observed period to an annual figure for the capacity check
  const annualizeFactor = 8760 / periodHours;

  const stats: TugMovementStats = {
    avgHours: {
      incoming: avg(hoursByType.incoming),
      sailing: avg(hoursByType.sailing),
      shifting: avg(hoursByType.shifting),
    },
    annualJobs: {
      incoming: countByType.incoming * annualizeFactor,
      sailing: countByType.sailing * annualizeFactor,
      shifting: countByType.shifting * annualizeFactor,
    },
  };

  const { data: fleet } = await db.from('tugs').select('id').eq('port_id', body.portId);
  const { data: availRow } = await db
    .from('tug_availability_assumptions')
    .select('*').eq('port_id', body.portId)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle();

  let tugResult = null;
  if (fleet?.length && availRow) {
    const deductions =
      availRow.planned_maint_h_yr + availRow.breakdown_maint_h_yr +
      availRow.starting_issues_h_yr + availRow.drydock_h_yr + availRow.shift_change_h_yr;
    tugResult = tugCapacity(stats, {
      fleetSize: fleet.length,
      grossHoursPerTugYear: availRow.gross_hours_per_year,
      deductionsPerTugYear: deductions,
    });
  }

  // ---- 4. Bottleneck classification --------------------------------------
  const bottleneck = classifyBottleneck({
    bor: bor.borPercent,
    avgWaitHours: queue?.Wq ?? 0,
    tugUtilization: tugResult?.utilization ?? 0,
    yardUtilization: body.yardUtilization ?? 0,
    evacuationRatio: body.evacuationRatio ?? 1,
  });

  return NextResponse.json({
    period: { start: body.periodStart, end: body.periodEnd, hours: periodHours },
    bor, queue, tug: tugResult, bottleneck,
    sampleSizes: { calls: arrivals, serviceTimeSamples: serviceHoursSamples.length },
  });
}
