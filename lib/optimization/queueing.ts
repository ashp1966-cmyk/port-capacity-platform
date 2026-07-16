// lib/optimization/queueing.ts

export interface MMcInput {
  lambda: number;  // arrival rate, vessels per hour
  mu: number;      // service rate per berth, vessels per hour (1 / mean service time)
  c: number;       // number of berths (servers)
}

export interface MMcResult {
  rho: number;        // utilization per server (offered load / c)
  pWait: number;       // Erlang C: probability an arriving vessel waits at all
  Lq: number;          // average queue length (vessels at anchorage)
  Wq: number;          // average waiting time, hours
  W: number;           // average total time in system (wait + service), hours
  stable: boolean;     // false if rho >= 1 — queue grows without bound
}

/** Classic M/M/c (Erlang C). Computed iteratively — never via a raw
 *  factorial — because a^c / c! overflows well before c reaches the teens
 *  for realistic offered loads. */
export function mmcQueue({ lambda, mu, c }: MMcInput): MMcResult {
  if (lambda <= 0 || mu <= 0 || c <= 0)
    throw new Error('lambda, mu and c must all be positive');

  const a = lambda / mu;          // offered load, Erlangs
  const rho = a / c;
  if (rho >= 1) return { rho, pWait: 1, Lq: Infinity, Wq: Infinity, W: Infinity, stable: false };

  let sum = 0;
  let term = 1;                   // running a^k / k!, starting at k=0
  for (let k = 0; k < c; k++) {
    sum += term;
    term = (term * a) / (k + 1);
  }
  const acOverCfact = term;       // now equals a^c / c!
  const denomTail = acOverCfact / (1 - rho);
  const erlangC = denomTail / (sum + denomTail);

  const Lq = (erlangC * rho) / (1 - rho);
  const Wq = Lq / lambda;
  return { rho, pWait: erlangC, Lq, Wq, W: Wq + 1 / mu, stable: true };
}

export interface MGcInput extends MMcInput {
  /** Coefficient of variation of observed service times (stdev / mean).
   *  CV = 1 recovers M/M/c exactly. CV > 1 (typical for mixed Capesize +
   *  barge traffic) widens the queue beyond the exponential assumption. */
  serviceTimeCV: number;
}

/** Allen-Cunneen approximation for M/G/c: scales the M/M/c waiting time
 *  by (1 + CV^2) / 2. Total time in system still adds the (now non-
 *  exponential) mean service time 1/mu directly, unscaled. */
export function mgcQueue(input: MGcInput): MMcResult & { serviceTimeCV: number } {
  const base = mmcQueue(input);
  if (!base.stable) return { ...base, serviceTimeCV: input.serviceTimeCV };
  const scale = (1 + input.serviceTimeCV ** 2) / 2;
  const Wq = base.Wq * scale;
  const Lq = Wq * input.lambda;
  return { ...base, Wq, Lq, W: Wq + 1 / input.mu, serviceTimeCV: input.serviceTimeCV };
}

/** Sample coefficient of variation from observed service-time hours,
 *  e.g. atd - atb per call at a given berth. Needs at least 2 samples. */
export function serviceTimeCV(hoursSamples: number[]): number {
  const n = hoursSamples.length;
  if (n < 2) return 1; // fall back to the exponential assumption
  const mean = hoursSamples.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 1;
  const variance = hoursSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) / mean;
}
