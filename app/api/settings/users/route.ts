// app/api/settings/users/route.ts
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
  if (!data.user) return false;
  const { data: profile } = await db.from('profiles').select('role').eq('id', data.user.id).single();
  return profile?.role === 'admin';
}

export async function GET(req: NextRequest) {
  const db = admin();
  if (!(await requireAdmin(req, db))) return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  const { data, error } = await db.from('profiles').select('id, email, role').order('email');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data });
}

export async function POST(req: NextRequest) {
  const db = admin();
  if (!(await requireAdmin(req, db))) return NextResponse.json({ error: 'Admin role required' }, { status: 403 });

  const body = await req.json();
  if (!body.userId || !['viewer', 'editor', 'admin'].includes(body.role))
    return NextResponse.json({ error: 'userId and a valid role are required' }, { status: 400 });

  const { error } = await db.from('profiles').update({ role: body.role }).eq('id', body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
