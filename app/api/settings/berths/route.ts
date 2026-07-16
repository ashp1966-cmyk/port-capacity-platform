// app/api/settings/berths/route.ts
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
  const { data, error } = await db
    .from('berths')
    .select('id, code, name, max_draft_m, max_loa_m, is_anchorage')
    .eq('port_id', portId).order('code');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ berths: data });
}

export async function POST(req: NextRequest) {
  const db = admin();
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await db.from('profiles').select('role').eq('id', userData.user.id).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin role required' }, { status: 403 });

  const body = await req.json();
  if (!body.portId || !body.code)
    return NextResponse.json({ error: 'portId and code are required' }, { status: 400 });

  const { error } = await db.from('berths').insert({
    port_id: body.portId, code: body.code, name: body.name ?? null,
    max_draft_m: body.maxDraftM ?? null, max_loa_m: body.maxLoaM ?? null,
    is_anchorage: !!body.isAnchorage,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
