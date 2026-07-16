// app/api/export/route.ts
// GET /api/export?kind=calls&portId=...&from=...&to=...
// GET /api/export?kind=forecasts&runId=...

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { vesselCallsToCsv, forecastsToCsv } from '@/lib/export/csv';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind');
  const db = admin();

  if (kind === 'calls') {
    const portId = req.nextUrl.searchParams.get('portId');
    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    if (!portId) return NextResponse.json({ error: 'portId is required' }, { status: 400 });

    let query = db
      .from('vessel_calls')
      .select('vcn, ata, atb, atd, cargo_volume_t, draft_fwd_m, vessels(name, category, dwt, loa_m), berths(code), commodities(name), direction')
      .eq('port_id', portId)
      .order('ata', { ascending: false })
      .limit(10000);
    if (from) query = query.gte('ata', from);
    if (to) query = query.lt('ata', to);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const csv = vesselCallsToCsv((data ?? []).map(row => ({
      vcn: row.vcn ?? '',
      vessel_name: (row as any).vessels?.name ?? '',
      category: (row as any).vessels?.category ?? '',
      ata: row.ata, atb: row.atb, atd: row.atd,
      berth: (row as any).berths?.code ?? null,
      commodity: (row as any).commodities?.name ?? null,
      direction: row.direction ?? null,
      cargo_volume_t: row.cargo_volume_t,
      dwt: (row as any).vessels?.dwt ?? null,
      loa_m: (row as any).vessels?.loa_m ?? null,
    })));

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="vessel-calls-${portId}.csv"`,
      },
    });
  }

  if (kind === 'forecasts') {
    const runId = req.nextUrl.searchParams.get('runId');
    if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });

    const { data, error } = await db
      .from('cargo_forecasts')
      .select('direction, scenario, period_start, volume, rationale, commodities(name)')
      .eq('run_id', runId)
      .order('period_start', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const csv = forecastsToCsv((data ?? []).map(row => ({
      commodity: (row as any).commodities?.name ?? 'Unknown',
      direction: row.direction, scenario: row.scenario,
      period_start: row.period_start, volume: row.volume,
      rationale: row.rationale ?? '',
    })));

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="forecast-${runId}.csv"`,
      },
    });
  }

  return NextResponse.json({ error: 'kind must be "calls" or "forecasts"' }, { status: 400 });
}
