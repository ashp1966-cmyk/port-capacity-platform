// app/api/forecast/route.ts
// POST /api/forecast  { portId, horizonMonths }
//
// Pipeline: pull cargo_records history -> compute deterministic baseline
// per commodity (lib/forecast/baseline) -> send both to Claude with the
// web_search tool for market-adjusted scenarios -> Zod-validate the JSON
// response -> persist forecast_runs (full audit) + cargo_forecasts rows.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeBaseline, type AnnualSeries } from '@/lib/forecast/baseline';
import { parseAndValidateForecastResponse } from '@/lib/forecast/schema';

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

const SYSTEM_PROMPT = `You are a maritime trade analyst producing cargo volume projections for a
specific port. You will receive: (a) the port profile, (b) historical annual
volumes per commodity and direction, (c) a deterministic statistical baseline
projection computed from that history, and (d) the projection horizon.

Your task: adjust the statistical baseline using current market intelligence
(commodity demand, trade-route shifts, regional infrastructure, policy) and
produce three scenarios per commodity: optimistic, baseline, conservative.

Rules:
1. Use web search to check current conditions for the port's top commodities
   before projecting. Cite the driver, not the URL, in each rationale.
2. Never project a negative volume. A collapsing trade goes to a small
   positive floor, not below zero.
3. Scenario spread must be justified: state in the rationale what would have
   to be true for optimistic vs conservative.
4. Keep each rationale to at most 2 sentences maximum. Be concise.
5. Your response MUST start immediately with { and contain nothing else.
   Do NOT write any preamble, greeting, explanation, or commentary.
   Do NOT write "I'll research" or "Let me" or any other text before the JSON.
   The very first character of your response must be {.
   The very last character must be }.
   Output ONLY the JSON object matching the schema provided.`;

interface ForecastRequest {
  portId: string;
  horizonMonths: 12 | 24 | 36;
  requestedBy?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ForecastRequest;
  if (!body.portId || ![12, 24, 36].includes(body.horizonMonths))
    return NextResponse.json({ error: 'portId and horizonMonths (12|24|36) are required' }, { status: 400 });

  const db = admin();

  // ---- 1. Port profile + cargo history ---------------------------------
  const { data: port, error: pErr } = await db
    .from('ports').select('code, name, country').eq('id', body.portId).single();
  if (pErr || !port) return NextResponse.json({ error: 'Unknown port' }, { status: 404 });

  const { data: records, error: rErr } = await db
    .from('cargo_records')
    .select('commodity_id, direction, year, volume, commodities(name)')
    .eq('port_id', body.portId)
    .order('year', { ascending: true });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!records?.length)
    return NextResponse.json({ error: 'No cargo history recorded for this port yet' }, { status: 422 });

  // Group into (commodity, direction) series
  type Key = string;
  const seriesMap = new Map<Key, { commodity: string; direction: string; byYear: Record<number, number> }>();
  for (const r of records) {
    const commodityName = (r as any).commodities?.name as string | undefined;
    if (!commodityName) continue;
    const key = `${commodityName}::${r.direction}`;
    const entry = seriesMap.get(key) ?? {
      commodity: commodityName, direction: r.direction,
      byYear: {} as Record<number, number>,
    };
    entry.byYear[r.year] = r.volume;
    seriesMap.set(key, entry);
  }

  const horizonYears = Math.ceil(body.horizonMonths / 12);
  const known = new Set<string>();
  const historyPayload: object[] = [];
  const baselinePayload: object[] = [];

  for (const { commodity, direction, byYear } of seriesMap.values()) {
    known.add(commodity);
    const series: AnnualSeries = { byYear };
    const baseline = computeBaseline(series, horizonYears);
    historyPayload.push({ commodity, direction, annual: byYear });
    baselinePayload.push({
      commodity, direction, method: baseline.method,
      projection: Object.fromEntries(baseline.points.map(p => [p.year, Math.round(p.volume)])),
    });
  }

  // ---- 2. Call Claude with web search -----------------------------------
  const userPayload = {
    port: { code: port.code, name: port.name, country: port.country },
    horizon_months: body.horizonMonths,
    history: historyPayload,
    statistical_baseline: baselinePayload,
    response_schema: {
      forecasts: [{
        commodity: 'string (must exactly match a commodity name from the input)',
        direction: 'import|export',
        scenario: 'optimistic|baseline|conservative',
        period_start: 'YYYY-01-01',
        volume: 'number >= 0',
        rationale: 'string, <=2 sentences',
      }],
    },
  };

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    }),
  });

  if (!apiRes.ok) {
    const detail = await apiRes.text().catch(() => '');
    return NextResponse.json({ error: `Anthropic API error (${apiRes.status})`, detail }, { status: 502 });
  }
  const data = await apiRes.json();

  const rawText = (data.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');

  // Strip markdown fences if present, then find the JSON object.
  // If the model prefaced with conversational text, locate the first { 
  // and last } to extract just the JSON portion.
  const stripped = rawText.replace(/```json|```/g, '').trim();
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  const text = firstBrace !== -1 && lastBrace > firstBrace
    ? stripped.slice(firstBrace, lastBrace + 1)
    : stripped;
  // ---- 3. Validate before writing anything -------------------------------
  let parsed;
  try {
    parsed = parseAndValidateForecastResponse(text, known);
  } catch (e) {
    // Archive the raw response even on failure — useful for debugging
    // prompt drift — but write nothing to cargo_forecasts.
    await db.from('forecast_runs').insert({
      port_id: body.portId, requested_by: body.requestedBy ?? null,
      model: 'claude-sonnet-4-6', horizon_months: body.horizonMonths,
      raw_response: { error: (e as Error).message, content: data.content },
    });
    return NextResponse.json({ error: `Validation failed: ${(e as Error).message}` }, { status: 422 });
  }

  // ---- 4. Persist ----------------------------------------------------------
  const { data: run, error: runErr } = await db
    .from('forecast_runs')
    .insert({
      port_id: body.portId, requested_by: body.requestedBy ?? null,
      model: 'claude-sonnet-4-6', horizon_months: body.horizonMonths,
      raw_response: data,
    })
    .select('id').single();
  if (runErr || !run) return NextResponse.json({ error: runErr?.message ?? 'Failed to save run' }, { status: 500 });

  const { data: commodities } = await db.from('commodities').select('id, name');
  const commodityIdByName = new Map((commodities ?? []).map(c => [c.name, c.id]));

  const rows = parsed.forecasts
    .filter(f => commodityIdByName.has(f.commodity))
    .map(f => ({
      run_id: run.id, port_id: body.portId,
      commodity_id: commodityIdByName.get(f.commodity),
      direction: f.direction, scenario: f.scenario,
      period_start: f.period_start, volume: f.volume, rationale: f.rationale,
    }));

  if (rows.length) {
    const { error: insErr } = await db.from('cargo_forecasts').insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message, runId: run.id }, { status: 500 });
  }

  return NextResponse.json({ runId: run.id, forecastCount: rows.length });
}
