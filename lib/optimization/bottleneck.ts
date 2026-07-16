// lib/optimization/bottleneck.ts
// Rule-of-thumb classifier combining the other three engines' outputs.
// The Claude narrative layer (Part 5 of the blueprint) explains the
// result in prose; this function only decides which explanation to ask for.

export type Bottleneck = 'sea_side' | 'storage_side' | 'land_side' | 'tug_side' | 'none';

export interface BottleneckInput {
  bor: number;                 // percent, from berthOccupancyRatio
  avgWaitHours: number;        // from mmcQueue/mgcQueue, Wq
  tugUtilization: number;      // 0..1, from tugCapacity
  yardUtilization: number;     // 0..1, external input (WMS/yard system)
  evacuationRatio: number;     // cargo evacuated / cargo landed, trailing 30d
}

const THRESHOLDS = {
  tugUtilHigh: 0.85, tugWaitHours: 2,
  borHigh: 70, seaWaitHours: 6,
  yardUtilHigh: 0.85,
  evacuationLow: 0.9,
} as const;

/** Order matters: checked most-specific (tug) to most-generic (land),
 *  since a tug shortage often shows up as elevated BOR too — checking
 *  tugs first attributes the delay to its actual cause. */
export function classifyBottleneck(m: BottleneckInput): Bottleneck {
  if (m.tugUtilization > THRESHOLDS.tugUtilHigh && m.avgWaitHours > THRESHOLDS.tugWaitHours)
    return 'tug_side';
  if (m.bor > THRESHOLDS.borHigh && m.avgWaitHours > THRESHOLDS.seaWaitHours)
    return 'sea_side';
  if (m.yardUtilization > THRESHOLDS.yardUtilHigh)
    return 'storage_side';
  if (m.evacuationRatio < THRESHOLDS.evacuationLow)
    return 'land_side';
  return 'none';
}
