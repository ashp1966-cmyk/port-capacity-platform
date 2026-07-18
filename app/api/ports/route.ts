// app/api/ports/route.ts
// Returns all ports using the service role key (bypasses RLS).
// Called by PortSessionContext instead of direct client-side query.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET() {
  const { data, error } = await admin()
    .from('ports')
    .select('id, code, name')
    .order('name');
  if (error) return NextResponse.json({ ports: [], error: error.message }, { status: 500 });
  return NextResponse.json({ ports: data });
}
