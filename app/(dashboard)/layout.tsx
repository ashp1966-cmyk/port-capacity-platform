// app/(dashboard)/layout.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PortSessionProvider, usePortSession } from '@/lib/session/PortSessionContext';
import { createClient } from '@/lib/supabase/client';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/data/upload', label: 'Upload data' },
  { href: '/capacity/berths', label: 'Berth capacity' },
  { href: '/capacity/tugs', label: 'Tug capacity' },
  { href: '/projections', label: 'Projections' },
  { href: '/settings', label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortSessionProvider>
      <Shell>{children}</Shell>
    </PortSessionProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, email, role, ports, portId, setPortId } = usePortSession();

  const signOut = async () => {
    await createClient().auth.signOut();
    router.push('/login');
  };

  return (
    <div className="flex min-h-screen bg-slate-950">
      <aside className="flex w-56 flex-col border-r border-slate-800 bg-[#0b1f3a] px-4 py-6">
        <div className="mb-6 text-sm font-medium text-amber-400">Port capacity</div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(item => (
            <Link
              key={item.href} href={item.href}
              className={`rounded-md px-3 py-2 text-sm ${
                pathname === item.href
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-800 pt-4 text-xs text-slate-500">
          <div className="truncate">{email}</div>
          <div className="mt-0.5 capitalize">{role}</div>
          <button onClick={signOut} className="mt-2 text-slate-400 hover:text-slate-200">Sign out</button>
        </div>
      </aside>

      <div className="flex-1">
        {!loading && ports.length > 0 && (
          <div className="border-b border-slate-800 px-6 py-2">
            <select
              value={portId ?? ''}
              onChange={e => setPortId(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300"
            >
              {ports.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </div>
        )}
        {loading ? (
          <div className="p-6 text-sm text-slate-400">Loading session…</div>
        ) : ports.length === 0 ? (
          <div className="m-6 rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
            No ports configured yet. Run the demo seed script, or add a port in Settings.
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
