// app/api/me/route.ts
// Returns the current user's profile (role) using the JWT from the request.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return NextResponse.json({ role: 'viewer', email: '' });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return NextResponse.json({ role: 'viewer', email: '' });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).single();

  return NextResponse.json({
    role: profile?.role ?? 'viewer',
    email: user.email ?? '',
    userId: user.id,
  });
}
