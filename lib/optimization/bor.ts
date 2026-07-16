// lib/optimization/bor.ts

export interface BerthOccupancyInput {
  /** Sum of hours each berth was occupied over the period, keyed by berth code. */
  occupiedHoursPerBerth: Record<string, number>;
  /** Number of berths in the group being evaluated. */
  berthCount: number;
  /** Evaluation period length in hours (e.g. 8760 for a year, 720 for a month). */
  periodHours: number;
}

export interface BerthOccupancyResult {
  borPercent: number;
  perBerth: Array<{ berth: string; hours: number; borPercent: number }>;
  band: 'under_utilized' | 'healthy' | 'congested';
}

/** BOR = sum(occupied hours) / (berths * period hours) * 100
 *  Thresholds follow UNCTAD port-performance guidance and are a starting
 *  point for the UI's traffic-light — not a hard rule. Ports with few
 *  berths and lumpy Capesize traffic tolerate lower BOR before queueing
 *  bites; the M/M/c panel below is the more precise signal. */
export function berthOccupancyRatio(i: BerthOccupancyInput): BerthOccupancyResult {
  if (i.berthCount <= 0) throw new Error('berthCount must be positive');
  if (i.periodHours <= 0) throw new Error('periodHours must be positive');

  const perBerth = Object.entries(i.occupiedHoursPerBerth).map(([berth, hours]) => ({
    berth, hours, borPercent: (hours / i.periodHours) * 100,
  }));
  const totalOccupied = perBerth.reduce((a, b) => a + b.hours, 0);
  const borPercent = (totalOccupied / (i.berthCount * i.periodHours)) * 100;

  const band: BerthOccupancyResult['band'] =
    borPercent < 40 ? 'under_utilized' : borPercent <= 70 ? 'healthy' : 'congested';

  return { borPercent, perBerth, band };
}
