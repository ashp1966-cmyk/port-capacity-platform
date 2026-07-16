// app/api/forecast/runs/[runId]/route.ts
// GET /api/forecast/runs/:runId — the persisted, already-validated
// cargo_forecasts rows for one run. This never re-touches the Anthropic
// API; it's a straight read of what was committed at run time.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const db = admin();
  const { data, error } = await db
    .from('cargo_forecasts')
    .select('direction, scenario, period_start, volume, rationale, commodities(name)')
    .eq('run_id', runId)
    .order('period_start', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const forecasts = (data ?? []).map(row => ({
    commodity: (row as any).commodities?.name ?? 'Unknown',
    direction: row.direction,
    scenario: row.scenario,
    period_start: row.period_start,
    volume: row.volume,
    rationale: row.rationale,
  }));

  return NextResponse.json({ forecasts });
}
