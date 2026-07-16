// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session instead. Safe to ignore.
          }
        },
      },
    },
  );
}

/** Fetches the current session's profile (role) alongside the user.
 *  Returns null if not signed in. */
export async function getSessionProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  const { data: { session } } = await supabase.auth.getSession();
  return {
    userId: user.id,
    email: user.email ?? '',
    role: (profile?.role as 'viewer' | 'editor' | 'admin') ?? 'viewer',
    accessToken: session?.access_token ?? '',
  };
}
