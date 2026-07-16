// app/api/settings/tugs/route.ts
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

  const { data: tugs, error } = await db
    .from('tugs').select('id, name, bollard_pull_t').eq('port_id', portId).order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: availRow } = await db
    .from('tug_availability_assumptions')
    .select('gross_hours_per_year, planned_maint_h_yr, breakdown_maint_h_yr, starting_issues_h_yr, drydock_h_yr, shift_change_h_yr')
    .eq('port_id', portId)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle();

  return NextResponse.json({ tugs, availability: availRow ?? null });
}

export async function POST(req: NextRequest) {
  const db = admin();
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await db.from('profiles').select('role').eq('id', userData.user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin role required' }, { status: 403 });

  const body = await req.json();
  if (!body.portId || !body.name)
    return NextResponse.json({ error: 'portId and name are required' }, { status: 400 });

  const { error } = await db.from('tugs').insert({
    port_id: body.portId, name: body.name, bollard_pull_t: body.bollardPullT ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
