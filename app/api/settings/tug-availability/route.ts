// app/api/settings/tug-availability/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

export async function POST(req: NextRequest) {
  const db = admin();
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await db.from('profiles').select('role').eq('id', userData.user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin role required' }, { status: 403 });

  const body = await req.json();
  if (!body.portId) return NextResponse.json({ error: 'portId is required' }, { status: 400 });

  // A new effective_from date creates a new row rather than mutating
  // history — future capacity calculations that reference an older
  // period keep using the assumptions that were true at that time.
  const { error } = await db.from('tug_availability_assumptions').upsert({
    port_id: body.portId,
    gross_hours_per_year: body.gross_hours_per_year,
    planned_maint_h_yr: body.planned_maint_h_yr,
    breakdown_maint_h_yr: body.breakdown_maint_h_yr,
    starting_issues_h_yr: body.starting_issues_h_yr,
    drydock_h_yr: body.drydock_h_yr,
    shift_change_h_yr: body.shift_change_h_yr,
    effective_from: new Date().toISOString().slice(0, 10),
  }, { onConflict: 'port_id,effective_from' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
