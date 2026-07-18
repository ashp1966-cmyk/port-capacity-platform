// lib/session/PortSessionContext.tsx
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

interface PortOption { id: string; code: string; name: string }

interface PortSessionValue {
  loading: boolean;
  accessToken: string;
  email: string;
  role: 'viewer' | 'editor' | 'admin';
  ports: PortOption[];
  portId: string | null;
  setPortId: (id: string) => void;
}

const PortSessionContext = createContext<PortSessionValue | null>(null);

export function PortSessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PortSessionValue['role']>('viewer');
  const [ports, setPorts] = useState<PortOption[]>([]);
  const [portId, setPortIdState] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      // Get session token from the browser client
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const token = session.access_token;
      setAccessToken(token);

      // Fetch profile and ports via server-side API routes
      // These use the service role key server-side, bypassing any
      // client-side RLS or NEXT_PUBLIC env var issues
      const [meRes, portsRes] = await Promise.all([
        fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/ports'),
      ]);

      if (meRes.ok) {
        const me = await meRes.json();
        setEmail(me.email ?? session.user.email ?? '');
        setRole(me.role ?? 'viewer');
      } else {
        setEmail(session.user.email ?? '');
      }

      if (portsRes.ok) {
        const { ports: portRows } = await portsRes.json();
        setPorts(portRows ?? []);
        const stored = typeof window !== 'undefined' ? localStorage.getItem('selectedPortId') : null;
        const initial = stored && portRows?.some((p: PortOption) => p.id === stored)
          ? stored : portRows?.[0]?.id ?? null;
        setPortIdState(initial);
      }

      setLoading(false);
    })();
  }, []);

  const setPortId = (id: string) => {
    setPortIdState(id);
    if (typeof window !== 'undefined') localStorage.setItem('selectedPortId', id);
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'selectedPortId' && e.newValue && ports.some(p => p.id === e.newValue)) {
        setPortIdState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ports]);

  return (
    <PortSessionContext.Provider value={{ loading, accessToken, email, role, ports, portId, setPortId }}>
      {children}
    </PortSessionContext.Provider>
  );
}

export function usePortSession(): PortSessionValue {
  const ctx = useContext(PortSessionContext);
  if (!ctx) throw new Error('usePortSession must be used within PortSessionProvider');
  return ctx;
}
