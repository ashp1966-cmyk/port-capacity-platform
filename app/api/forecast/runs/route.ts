// app/api/forecast/runs/route.ts
// GET /api/forecast/runs?portId=...
// Lists past forecast runs for a port, newest first, with a scenario count
// per run (cheap aggregate, not the full forecast rows).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

export async function GET(req: NextRequest) {
  const portId = req.nextUrl.searchParams.get('portId');
  if (!portId) return NextResponse.json({ error: 'portId is required' }, { status: 400 });

  const db = admin();
  const { data: runs, error } = await db
    .from('forecast_runs')
    .select('id, model, horizon_months, created_at')
    .eq('port_id', portId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withCounts = await Promise.all(
    (runs ?? []).map(async run => {
      const { count } = await db
        .from('cargo_forecasts')
        .select('id', { count: 'exact', head: true })
        .eq('run_id', run.id);
      return { ...run, forecast_count: count ?? 0 };
    }),
  );

  return NextResponse.json({ runs: withCounts });
}
