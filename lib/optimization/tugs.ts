// lib/optimization/tugs.ts
// Formalizes the 2020 MPT tug-hours model: required vs available hours,
// net of maintenance/breakdown/drydock/shift-change deductions, plus a
// data-driven allocation-rule engine (2 tugs <=75k DWT, 3 above, 3 if
// draft >=12.8m, bollard pull minima).

export interface TugMovementStats {
  /** Average tug-hours per job, by movement type — computed from
   *  movement_tugs join on movements, grouped by movement_type. */
  avgHours: { incoming: number; sailing: number; shifting: number };
  /** Projected annual number of jobs, by movement type. */
  annualJobs: { incoming: number; sailing: number; shifting: number };
}

export interface TugAvailability {
  fleetSize: number;
  grossHoursPerTugYear: number;   // default 8760
  deductionsPerTugYear: number;   // maint + breakdown + starting + drydock + shift change, summed
}

export interface TugCapacityResult {
  requiredHours: number;
  availableHours: number;
  utilization: number;            // required / available; >1 means the fleet is short
  headroomHours: number;          // available - required; negative means short
  additionalTugsNeeded: number;   // 0 if headroom >= 0
}

export function tugCapacity(
  stats: TugMovementStats, avail: TugAvailability,
): TugCapacityResult {
  if (avail.fleetSize <= 0) throw new Error('fleetSize must be positive');

  const requiredHours =
    stats.avgHours.incoming * stats.annualJobs.incoming +
    stats.avgHours.sailing * stats.annualJobs.sailing +
    stats.avgHours.shifting * stats.annualJobs.shifting;

  const netPerTug = avail.grossHoursPerTugYear - avail.deductionsPerTugYear;
  if (netPerTug <= 0) throw new Error('deductions exceed gross hours per tug');

  const availableHours = avail.fleetSize * netPerTug;
  const headroomHours = availableHours - requiredHours;

  return {
    requiredHours, availableHours,
    utilization: requiredHours / availableHours,
    headroomHours,
    additionalTugsNeeded: headroomHours >= 0 ? 0 : Math.ceil(-headroomHours / netPerTug),
  };
}

export interface AllocationRule {
  priority: number;               // evaluated ascending; first match wins
  minDwt?: number;
  maxDwt?: number;
  minDraftM?: number;
  tugsRequired: number;
  minBollardT?: number;
  note?: string;
}

/** Seed rules mirroring the 2020 MPT model. Insert into
 *  tug_allocation_rules per port — these are the defaults, not a fact
 *  about every port's actual harbour-master policy. */
export const DEFAULT_ALLOCATION_RULES: AllocationRule[] = [
  { priority: 1, minDraftM: 12.8, tugsRequired: 3, minBollardT: 50,
    note: 'Draft >=12.8m or Capesize — 2x 50t + 1x 45t standby' },
  { priority: 2, minDwt: 75000, tugsRequired: 3,
    note: 'DWT above 75,000' },
  { priority: 3, maxDwt: 75000, tugsRequired: 2,
    note: 'DWT up to 75,000' },
];

export function tugsForVessel(
  dwt: number, draftM: number, rules: AllocationRule[] = DEFAULT_ALLOCATION_RULES,
): { tugs: number; minBollardT?: number; matchedRule?: AllocationRule } {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    const dwtOk =
      (r.minDwt === undefined || dwt >= r.minDwt) &&
      (r.maxDwt === undefined || dwt <= r.maxDwt);
    const draftOk = r.minDraftM === undefined || draftM >= r.minDraftM;
    if (dwtOk && draftOk) return { tugs: r.tugsRequired, minBollardT: r.minBollardT, matchedRule: r };
  }
  return { tugs: 2 }; // conservative default if no rule matches
}

/** Delay-trigger check — the 2020 model's decision rule for fleet
 *  expansion: recommend action if the share of delayed calls exceeds
 *  the port's trigger point, OR the annualized cost of tug-caused delay
 *  exceeds one tug's annual charter hire. Both inputs are configuration. */
export function shouldRecommendFleetExpansion(input: {
  delayedCallsShare: number;      // 0..1, trailing period
  triggerPoint: number;           // e.g. 0.01 for MPT's 1%
  annualDelayCostAttributedToTugs: number;
  annualTugCharterHire: number;
}): boolean {
  return input.delayedCallsShare > input.triggerPoint
    || input.annualDelayCostAttributedToTugs > input.annualTugCharterHire;
}
