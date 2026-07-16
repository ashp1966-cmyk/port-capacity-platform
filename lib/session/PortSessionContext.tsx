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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      setAccessToken(session.access_token);
      setEmail(session.user.email ?? '');

      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single();
      if (profile) setRole(profile.role);

      const { data: portRows } = await supabase.from('ports').select('id, code, name').order('name');
      setPorts(portRows ?? []);

      const stored = typeof window !== 'undefined' ? localStorage.getItem('selectedPortId') : null;
      const initial = stored && portRows?.some(p => p.id === stored) ? stored : portRows?.[0]?.id ?? null;
      setPortIdState(initial);

      setLoading(false);
    })();
  }, []);

  const setPortId = (id: string) => {
    setPortIdState(id);
    if (typeof window !== 'undefined') localStorage.setItem('selectedPortId', id);
  };

  // Keep every open tab in sync: if the port is switched in one tab,
  // storage fires here in every OTHER tab and updates their state too.
  // Without this, a stale tab can silently commit data to the wrong
  // port — exactly the failure mode this is closing off.
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
