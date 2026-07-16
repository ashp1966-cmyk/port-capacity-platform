// app/api/ingest/route.ts
// POST /api/ingest
//
// Flow (matches the /data/upload UI in the blueprint):
//   1. Client parses the CSV/XLSX in the browser (papaparse / SheetJS),
//      runs normalizeRow() per record, and POSTs an IngestRequest.
//   2. dryRun: true  -> parse + validate, return IngestReport. No writes.
//   3. dryRun: false -> parse again server-side (never trust a client
//      report), then upsert vessels, calls, movements, tug jobs.
//
// Idempotency: unique (port_id, vcn) on vessel_calls. Re-uploading the
// same file updates calls in place; movements/tug jobs for an updated
// call are deleted and re-inserted (delete cascades handle children).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseRawRows } from '@/lib/ingest/parseRawData';
import type { IngestRequest } from '@/lib/ingest/types';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,   // server-only; never NEXT_PUBLIC
    { auth: { persistSession: false } },
  );

export async function POST(req: NextRequest) {
  // ---- 1. AuthZ: caller must be editor or admin -----------------------
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });

  const db = admin();
  const { data: userData, error: userErr } = await db.auth.getUser(jwt);
  if (userErr || !userData.user)
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  const { data: profile } = await db
    .from('profiles').select('role').eq('id', userData.user.id).single();
  if (!profile || !['editor', 'admin'].includes(profile.role))
    return NextResponse.json({ error: 'Editor role required' }, { status: 403 });

  // ---- 2. Parse + validate --------------------------------------------
  const body = (await req.json()) as IngestRequest;
  if (!body.portId || !Array.isArray(body.rows))
    return NextResponse.json({ error: 'portId and rows are required' }, { status: 400 });
  if (body.rows.length > 25_000)
    return NextResponse.json(
      { error: 'Batch too large — split files above 25,000 rows' }, { status: 413 });

  const { calls, report } = parseRawRows(
    body.rows, body.utcOffset, body.knownBerthCodes, body.seaCodes ?? ['SEA'],
  );

  if (body.dryRun) return NextResponse.json({ report });

  const hardErrors = report.issues.filter(i => i.severity === 'error');
  if (calls.length === 0)
    return NextResponse.json({ report, error: 'No valid calls to commit' }, { status: 422 });

  // ---- 3. Reference lookups -------------------------------------------
  const { data: berths } = await db
    .from('berths').select('id, code').eq('port_id', body.portId);
  const berthByCode = new Map((berths ?? []).map(b => [b.code.toUpperCase(), b.id]));

  // Upsert tugs seen in the file (unique port_id+name)
  const tugNames = [...new Set(
    calls.flatMap(c => c.movements.flatMap(m => m.tugJobs.map(t => t.tugName))))];
  if (tugNames.length) {
    await db.from('tugs').upsert(
      tugNames.map(name => ({ port_id: body.portId, name })),
      { onConflict: 'port_id,name', ignoreDuplicates: true });
  }
  const { data: tugs } = await db
    .from('tugs').select('id, name').eq('port_id', body.portId);
  const tugByName = new Map((tugs ?? []).map(t => [t.name.toUpperCase(), t.id]));

  // ---- 4. Upsert vessels (dedupe by name; IMO absent in this export) ---
  const vesselMap = new Map(calls.map(c => [c.vessel.name, c.vessel]));
  const { data: vesselRows, error: vErr } = await db
    .from('vessels')
    .upsert(
      [...vesselMap.values()].map(v => ({
        name: v.name, category: v.category,
        dwt: v.dwt, grt: v.grt, loa_m: v.loaM,
      })),
      { onConflict: 'name' })          // requires: create unique index on vessels(name)
    .select('id, name');
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
  const vesselByName = new Map((vesselRows ?? []).map(v => [v.name, v.id]));

  // ---- 5. Upsert calls, then rebuild their movements -------------------
  let committedCalls = 0, committedMovements = 0, committedTugJobs = 0;

  for (const batch of chunk(calls, 500)) {
    const { data: callRows, error: cErr } = await db
      .from('vessel_calls')
      .upsert(batch.map(c => ({
        port_id: body.portId,
        vessel_id: vesselByName.get(c.vessel.name),
        vcn: c.vcn,
        purpose: c.purpose,
        ata: c.ata, atb: c.atb, atd: c.atd,
        primary_berth_id: c.primaryBerthCode
          ? berthByCode.get(c.primaryBerthCode) ?? null : null,
        draft_fwd_m: c.draftFwdM, draft_aft_m: c.draftAftM,
        source_file: `ingest:${new Date().toISOString().slice(0, 10)}`,
      })), { onConflict: 'port_id,vcn' })
      .select('id, vcn');
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

    const callIdByVcn = new Map((callRows ?? []).map(r => [r.vcn, r.id]));
    const callIds = [...callIdByVcn.values()];

    // Rebuild children for idempotent re-upload
    await db.from('movements').delete().in('call_id', callIds);

    const movementInserts = batch.flatMap(c =>
      c.movements.map(m => ({
        call_id: callIdByVcn.get(c.vcn),
        movement_type: m.movementType,
        from_location: m.fromLocation,
        to_location: m.toLocation,
        started_at: m.startedAt,
        completed_at: m.completedAt,
        pilot_name: m.pilotName,
      })));

    const { data: mvRows, error: mErr } = await db
      .from('movements').insert(movementInserts)
      .select('id, call_id, movement_type, from_location, to_location, started_at');
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

    // Re-associate tug jobs with their inserted movement rows by position
    const cursor = new Map<string, number>();
    const tugInserts: object[] = [];
    for (const c of batch) {
      const callId = callIdByVcn.get(c.vcn);
      const rowsForCall = (mvRows ?? []).filter(r => r.call_id === callId);
      c.movements.forEach(m => {
        const k = String(callId);
        const idx = cursor.get(k) ?? 0;
        cursor.set(k, idx + 1);
        const mvRow = rowsForCall[idx];
        if (!mvRow) return;
        for (const t of m.tugJobs) {
          const tugId = tugByName.get(t.tugName);
          if (!tugId) continue;
          tugInserts.push({
            movement_id: mvRow.id, tug_id: tugId,
            tug_order: t.tugOrder, start_at: t.startAt, end_at: t.endAt,
          });
        }
      });
    }
    if (tugInserts.length) {
      const { error: tErr } = await db.from('movement_tugs').insert(tugInserts);
      if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
    }

    committedCalls += batch.length;
    committedMovements += movementInserts.length;
    committedTugJobs += tugInserts.length;
  }

  return NextResponse.json({
    report,
    committed: {
      calls: committedCalls,
      movements: committedMovements,
      tugJobs: committedTugJobs,
      rowsRejected: report.rowsRejected,
      hardErrors: hardErrors.length,
    },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
