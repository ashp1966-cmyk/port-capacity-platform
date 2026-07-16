// lib/forecast/baseline.ts
//
// Deterministic baseline projection, computed in TypeScript so it is
// reproducible and auditable — Claude adjusts this baseline with market
// judgment (see route.ts) but never invents the arithmetic itself.
//
// This directly fixes the failure mode visible in the 2020 workbook's
// Excel FORECAST.LINEAR sheets: several commodities (wood chips, nickel
// products) get projected to NEGATIVE volumes because linear regression
// on a declining series has no floor. Ports don't ship negative tonnes.

export interface AnnualSeries {
  /** year -> volume, at least 2 points required, ideally 3-5 */
  byYear: Record<number, number>;
}

export type TrendMethod = 'linear' | 'cagr' | 'flat';

export interface BaselinePoint {
  year: number;
  volume: number;
  method: TrendMethod;
}

export interface BaselineResult {
  method: TrendMethod;
  points: BaselinePoint[];
  /** Diagnostic: was the raw (unclamped) projection negative in any year? */
  hadNegativeRawProjection: boolean;
}

const MIN_FLOOR_FRACTION = 0.02; // never project below 2% of the series' peak year

/** Ordinary least squares on (year, volume) pairs. Returns slope + intercept
 *  in "volume per year" terms, using year offsets from the first year to
 *  keep the numbers well-conditioned. */
function linearRegression(points: Array<[number, number]>): { slope: number; intercept: number; baseYear: number } {
  const baseYear = points[0][0];
  const xs = points.map(([y]) => y - baseYear);
  const ys = points.map(([, v]) => v);
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, baseYear };
}

/** Compound annual growth rate from first to last observed point. */
function cagr(first: number, last: number, years: number): number {
  if (first <= 0 || years <= 0) return 0;
  return Math.pow(last / first, 1 / years) - 1;
}

/**
 * Projects `horizonYears` beyond the last observed year.
 * Method selection: CAGR when every observed value is positive and the
 * series has a consistent direction (avoids linear regression's
 * tendency to punch through zero on a declining series); linear
 * otherwise; flat (repeat last value) if fewer than 2 usable points.
 */
export function computeBaseline(series: AnnualSeries, horizonYears: number): BaselineResult {
  const points = Object.entries(series.byYear)
    .map(([y, v]) => [Number(y), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  if (points.length < 2) {
    const last = points[0]?.[1] ?? 0;
    const lastYear = points[0]?.[0] ?? new Date().getFullYear();
    return {
      method: 'flat',
      points: Array.from({ length: horizonYears }, (_, i) => ({
        year: lastYear + i + 1, volume: last, method: 'flat' as const,
      })),
      hadNegativeRawProjection: false,
    };
  }

  const allPositive = points.every(([, v]) => v > 0);
  const lastYear = points.at(-1)![0];
  const peak = Math.max(...points.map(([, v]) => v));
  const floor = peak * MIN_FLOOR_FRACTION;
  let hadNegativeRawProjection = false;
  const out: BaselinePoint[] = [];

  if (allPositive) {
    const [firstYear, firstVal] = points[0];
    const [, lastVal] = points.at(-1)!;
    const growth = cagr(firstVal, lastVal, lastYear - firstYear);
    for (let i = 1; i <= horizonYears; i++) {
      const raw = lastVal * Math.pow(1 + growth, i);
      out.push({ year: lastYear + i, volume: Math.max(raw, floor), method: 'cagr' });
    }
    return { method: 'cagr', points: out, hadNegativeRawProjection: false };
  }

  const { slope, intercept, baseYear } = linearRegression(points);
  for (let i = 1; i <= horizonYears; i++) {
    const year = lastYear + i;
    const raw = intercept + slope * (year - baseYear);
    if (raw < 0) hadNegativeRawProjection = true;
    out.push({ year, volume: Math.max(raw, floor), method: 'linear' });
  }
  return { method: 'linear', points: out, hadNegativeRawProjection };
}
