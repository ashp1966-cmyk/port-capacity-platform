// app/(dashboard)/settings/page.tsx
'use client';

// Admin-only configuration screen. RLS already blocks non-admins from
// writing to these tables server-side (Part 2 policies); this page's
// own role check is a UX convenience, not the security boundary.

import { useEffect, useState } from 'react';
import { usePortSession } from '@/lib/session/PortSessionContext';

interface Port { id: string; code: string; name: string; country: string; timezone: string }
interface Berth { id: string; code: string; name: string | null; max_draft_m: number | null; max_loa_m: number | null; is_anchorage: boolean }
interface Tug { id: string; name: string; bollard_pull_t: number | null }
interface Availability {
  gross_hours_per_year: number; planned_maint_h_yr: number; breakdown_maint_h_yr: number;
  starting_issues_h_yr: number; drydock_h_yr: number; shift_change_h_yr: number;
}
interface UserRow { id: string; email: string; role: 'viewer' | 'editor' | 'admin' }

type Tab = 'ports' | 'berths' | 'tugs' | 'users';

export default function SettingsPage() {
  const { accessToken, role: myRole } = usePortSession();
  const [tab, setTab] = useState<Tab>('ports');
  const [selectedPortId, setSelectedPortId] = useState<string | null>(null);

  if (myRole !== 'admin') {
    return (
      <div className="m-6 rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
        Settings are restricted to Admin users. Contact your port administrator for changes.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-medium text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">Ports, berths, tugs, and user access</p>
      </header>

      <nav className="flex gap-1 border-b border-slate-800">
        {(['ports', 'berths', 'tugs', 'users'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              t === tab
                ? 'border-b-2 border-[#3D9BC4] px-4 py-2 text-sm font-medium text-[#3D9BC4]'
                : 'border-b-2 border-transparent px-4 py-2 text-sm text-slate-400 hover:text-slate-200'
            }
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      {tab === 'ports' && (
        <PortsTab accessToken={accessToken} onSelect={setSelectedPortId} selected={selectedPortId} />
      )}
      {tab === 'berths' && selectedPortId && (
        <BerthsTab accessToken={accessToken} portId={selectedPortId} />
      )}
      {tab === 'berths' && !selectedPortId && (
        <EmptyHint text="Select a port under the Ports tab first." />
      )}
      {tab === 'tugs' && selectedPortId && (
        <TugsTab accessToken={accessToken} portId={selectedPortId} />
      )}
      {tab === 'tugs' && !selectedPortId && (
        <EmptyHint text="Select a port under the Ports tab first." />
      )}
      {tab === 'users' && <UsersTab accessToken={accessToken} />}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-6 text-center text-sm text-slate-500">{text}</div>;
}

// ---- Ports --------------------------------------------------------------
function PortsTab({
  accessToken, onSelect, selected,
}: { accessToken: string; onSelect: (id: string) => void; selected: string | null }) {
  const [ports, setPorts] = useState<Port[] | null>(null);
  const [form, setForm] = useState({ code: '', name: '', country: 'South Africa', timezone: 'Africa/Johannesburg' });
  const [saving, setSaving] = useState(false);

  const load = () =>
    fetch('/api/settings/ports', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json()).then(d => setPorts(d.ports));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const create = async () => {
    if (!form.code || !form.name) return;
    setSaving(true);
    await fetch('/api/settings/ports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(form),
    });
    setForm({ code: '', name: '', country: 'South Africa', timezone: 'Africa/Johannesburg' });
    setSaving(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 p-4">
        <div className="mb-3 text-sm font-medium text-slate-200">Add a port</div>
        <div className="grid grid-cols-4 gap-2">
          <Input placeholder="Code (e.g. ZADUR)" value={form.code} onChange={v => setForm(f => ({ ...f, code: v.toUpperCase() }))} />
          <Input placeholder="Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
          <Input placeholder="Country" value={form.country} onChange={v => setForm(f => ({ ...f, country: v }))} />
          <Input placeholder="Timezone" value={form.timezone} onChange={v => setForm(f => ({ ...f, timezone: v }))} />
        </div>
        <button onClick={create} disabled={saving}
          className="mt-3 rounded-md bg-[#3D9BC4] px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-[#5BAFD4] disabled:opacity-50">
          {saving ? 'Adding…' : 'Add port'}
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 divide-y divide-slate-800">
        {ports === null ? (
          <div className="px-4 py-4 text-sm text-slate-500">Loading…</div>
        ) : ports.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-500">No ports yet.</div>
        ) : ports.map(p => (
          <button
            key={p.id} onClick={() => onSelect(p.id)}
            className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${p.id === selected ? 'bg-slate-900/60' : 'hover:bg-slate-900/30'}`}
          >
            <span className="text-slate-200">{p.name} <span className="text-slate-500">({p.code})</span></span>
            <span className="text-xs text-slate-500">{p.country}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Berths ---------------------------------------------------------------
function BerthsTab({ accessToken, portId }: { accessToken: string; portId: string }) {
  const [berths, setBerths] = useState<Berth[] | null>(null);
  const [form, setForm] = useState({ code: '', name: '', max_draft_m: '', max_loa_m: '', is_anchorage: false });

  const load = () =>
    fetch(`/api/settings/berths?portId=${portId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json()).then(d => setBerths(d.berths));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [portId]);

  const create = async () => {
    if (!form.code) return;
    await fetch('/api/settings/berths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        portId, code: form.code.toUpperCase(), name: form.name || null,
        maxDraftM: form.max_draft_m ? Number(form.max_draft_m) : null,
        maxLoaM: form.max_loa_m ? Number(form.max_loa_m) : null,
        isAnchorage: form.is_anchorage,
      }),
    });
    setForm({ code: '', name: '', max_draft_m: '', max_loa_m: '', is_anchorage: false });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 p-4">
        <div className="mb-3 text-sm font-medium text-slate-200">Add a berth</div>
        <div className="grid grid-cols-5 gap-2 items-end">
          <Input placeholder="Code" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} />
          <Input placeholder="Name (optional)" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
          <Input placeholder="Max draft (m)" value={form.max_draft_m} onChange={v => setForm(f => ({ ...f, max_draft_m: v }))} />
          <Input placeholder="Max LOA (m)" value={form.max_loa_m} onChange={v => setForm(f => ({ ...f, max_loa_m: v }))} />
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={form.is_anchorage} onChange={e => setForm(f => ({ ...f, is_anchorage: e.target.checked }))} />
            Anchorage
          </label>
        </div>
        <button onClick={create} className="mt-3 rounded-md bg-[#3D9BC4] px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-[#5BAFD4]">
          Add berth
        </button>
      </div>

      <div className="rounded-xl border border-slate-800 divide-y divide-slate-800">
        {berths === null ? (
          <div className="px-4 py-4 text-sm text-slate-500">Loading…</div>
        ) : berths.map(b => (
          <div key={b.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="text-slate-200">{b.code}{b.name ? ` — ${b.name}` : ''}{b.is_anchorage ? ' (anchorage)' : ''}</span>
            <span className="text-xs text-slate-500">
              {b.max_draft_m ? `draft ≤${b.max_draft_m}m` : ''}{b.max_loa_m ? ` · LOA ≤${b.max_loa_m}m` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Tugs + availability assumptions ---------------------------------------
function TugsTab({ accessToken, portId }: { accessToken: string; portId: string }) {
  const [tugs, setTugs] = useState<Tug[] | null>(null);
  const [avail, setAvail] = useState<Availability>({
    gross_hours_per_year: 8760, planned_maint_h_yr: 60, breakdown_maint_h_yr: 60,
    starting_issues_h_yr: 12, drydock_h_yr: 288, shift_change_h_yr: 360,
  });
  const [newTugName, setNewTugName] = useState('');
  const [newTugBollard, setNewTugBollard] = useState('');
  const [savingAvail, setSavingAvail] = useState(false);

  const load = () => {
    fetch(`/api/settings/tugs?portId=${portId}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json()).then(d => { setTugs(d.tugs); if (d.availability) setAvail(d.availability); });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [portId]);

  const addTug = async () => {
    if (!newTugName) return;
    await fetch('/api/settings/tugs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ portId, name: newTugName.toUpperCase(), bollardPullT: newTugBollard ? Number(newTugBollard) : null }),
    });
    setNewTugName(''); setNewTugBollard(''); load();
  };

  const saveAvailability = async () => {
    setSavingAvail(true);
    await fetch('/api/settings/tug-availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ portId, ...avail }),
    });
    setSavingAvail(false);
  };

  const netHours = avail.gross_hours_per_year - avail.planned_maint_h_yr - avail.breakdown_maint_h_yr
    - avail.starting_issues_h_yr - avail.drydock_h_yr - avail.shift_change_h_yr;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 p-4">
        <div className="mb-3 text-sm font-medium text-slate-200">Fleet</div>
        <div className="mb-3 flex gap-2">
          <Input placeholder="Tug name" value={newTugName} onChange={setNewTugName} />
          <Input placeholder="Bollard pull (t)" value={newTugBollard} onChange={setNewTugBollard} />
          <button onClick={addTug} className="rounded-md bg-[#3D9BC4] px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-[#5BAFD4] whitespace-nowrap">
            Add tug
          </button>
        </div>
        <div className="divide-y divide-slate-800 rounded-lg border border-slate-800">
          {tugs === null ? (
            <div className="px-4 py-3 text-sm text-slate-500">Loading…</div>
          ) : tugs.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">No tugs registered yet.</div>
          ) : tugs.map(t => (
            <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-slate-200">{t.name}</span>
              <span className="text-xs text-slate-500">{t.bollard_pull_t ? `${t.bollard_pull_t}t bollard pull` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 p-4">
        <div className="mb-3 text-sm font-medium text-slate-200">
          Annual hour deductions per tug
          <span className="ml-2 text-xs font-normal text-slate-500">(defaults from the 2020 MPT model)</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Gross hours/year" value={avail.gross_hours_per_year} onChange={v => setAvail(a => ({ ...a, gross_hours_per_year: v }))} />
          <NumberField label="Planned maintenance" value={avail.planned_maint_h_yr} onChange={v => setAvail(a => ({ ...a, planned_maint_h_yr: v }))} />
          <NumberField label="Breakdown maintenance" value={avail.breakdown_maint_h_yr} onChange={v => setAvail(a => ({ ...a, breakdown_maint_h_yr: v }))} />
          <NumberField label="Starting issues" value={avail.starting_issues_h_yr} onChange={v => setAvail(a => ({ ...a, starting_issues_h_yr: v }))} />
          <NumberField label="Drydocking" value={avail.drydock_h_yr} onChange={v => setAvail(a => ({ ...a, drydock_h_yr: v }))} />
          <NumberField label="Shift changes" value={avail.shift_change_h_yr} onChange={v => setAvail(a => ({ ...a, shift_change_h_yr: v }))} />
        </div>
        <div className="mt-3 text-sm text-slate-400">Net available: <span className="font-medium text-slate-200">{netHours.toLocaleString()}</span> hours/tug/year</div>
        <button onClick={saveAvailability} disabled={savingAvail}
          className="mt-3 rounded-md bg-[#3D9BC4] px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-[#5BAFD4] disabled:opacity-50">
          {savingAvail ? 'Saving…' : 'Save assumptions'}
        </button>
      </div>
    </div>
  );
}

// ---- Users ------------------------------------------------------------------
function UsersTab({ accessToken }: { accessToken: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);

  const load = () =>
    fetch('/api/settings/users', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json()).then(d => setUsers(d.users));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const setRole = async (id: string, role: UserRow['role']) => {
    await fetch('/api/settings/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ userId: id, role }),
    });
    load();
  };

  return (
    <div className="rounded-xl border border-slate-800 divide-y divide-slate-800">
      {users === null ? (
        <div className="px-4 py-4 text-sm text-slate-500">Loading…</div>
      ) : users.map(u => (
        <div key={u.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="text-slate-200">{u.email}</span>
          <select
            value={u.role} onChange={e => setRole(u.id, e.target.value as UserRow['role'])}
            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      ))}
    </div>
  );
}

// ---- Shared bits --------------------------------------------------------------
function Input({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
    />
  );
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      <input
        type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200"
      />
    </label>
  );
}
