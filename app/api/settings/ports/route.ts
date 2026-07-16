// app/api/settings/ports/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

async function requireAdmin(req: NextRequest, db: ReturnType<typeof admin>) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data } = await db.auth.getUser(jwt);
  if (!data.user) return null;
  const { data: profile } = await db.from('profiles').select('role').eq('id', data.user.id).single();
  return profile?.role === 'admin' ? data.user.id : null;
}

export async function GET() {
  const db = admin();
  const { data, error } = await db.from('ports').select('id, code, name, country, timezone').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ports: data });
}

export async function POST(req: NextRequest) {
  const db = admin();
  const userId = await requireAdmin(req, db);
  if (!userId) return NextResponse.json({ error: 'Admin role required' }, { status: 403 });

  const body = await req.json();
  if (!body.code || !body.name)
    return NextResponse.json({ error: 'code and name are required' }, { status: 400 });

  const { error } = await db.from('ports').insert({
    code: body.code, name: body.name,
    country: body.country ?? 'South Africa',
    timezone: body.timezone ?? 'Africa/Johannesburg',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
