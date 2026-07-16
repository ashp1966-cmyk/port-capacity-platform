// lib/forecast/schema.ts
// The single gate between Claude's text output and the database.
// Nothing from a forecast run reaches cargo_forecasts without passing
// this validation — volume >= 0 is enforced here, not trusted from the model.

import { z } from 'zod';

export const ForecastScenario = z.enum(['optimistic', 'baseline', 'conservative']);
export const TradeDirection = z.enum(['import', 'export']);

export const ForecastPoint = z.object({
  commodity: z.string().min(1).max(120),
  direction: TradeDirection,
  scenario: ForecastScenario,
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  volume: z.number().finite().min(0, 'volumes cannot be negative'),
  rationale: z.string().max(800),
});

export const ForecastResponse = z.object({
  forecasts: z.array(ForecastPoint).min(1),
});

export type ForecastPointT = z.infer<typeof ForecastPoint>;
export type ForecastResponseT = z.infer<typeof ForecastResponse>;

/**
 * Strips markdown code fences a model sometimes adds despite instructions,
 * parses JSON, and validates. Throws a descriptive Error on any failure —
 * callers should catch this and surface it as a 422, never write partial data.
 */
export function parseAndValidateForecastResponse(
  rawText: string,
  knownCommodities: Set<string>,
): ForecastResponseT {
  const cleaned = rawText.replace(/```json|```/g, '').trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Model response was not valid JSON: ${(e as Error).message}`);
  }

  const parsed = ForecastResponse.parse(json); // throws ZodError with details

  const unknown = parsed.forecasts
    .map(f => f.commodity)
    .filter(c => !knownCommodities.has(c));
  if (unknown.length) {
    throw new Error(
      `Response references commodities not in the input set: ${[...new Set(unknown)].join(', ')}`,
    );
  }

  return parsed;
}
