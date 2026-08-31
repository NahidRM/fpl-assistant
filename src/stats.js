/** Pure statistical primitives. No FPL knowledge lives here. */

/** Pull a rate toward a prior, weighted by sample size. */
export function shrink(rate, minutes, medianRate, k) {
  return (minutes * rate + k * medianRate) / (minutes + k);
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** P(X >= threshold) for a Poisson with the given mean. */
export function poissonAtLeast(threshold, mean) {
  if (mean <= 0 || threshold <= 0) return mean <= 0 ? 0 : 1;
  let term = Math.exp(-mean);
  let cumulative = term;
  for (let k = 1; k < threshold; k++) {
    term *= mean / k;
    cumulative += term;
  }
  return Math.max(0, 1 - cumulative);
}

/**
 * P(X >= threshold) for a negative binomial with the given mean and dispersion r,
 * where variance = mean + mean^2 / r. Larger r means less clustering; Infinity is Poisson.
 */
export function negBinomAtLeast(threshold, mean, r) {
  if (mean <= 0) return 0;
  if (!Number.isFinite(r) || r <= 0) return poissonAtLeast(threshold, mean);
  const p = r / (r + mean);
  let term = Math.pow(p, r);       // P(X = 0)
  let cumulative = term;
  for (let k = 1; k < threshold; k++) {
    term *= ((k - 1 + r) / k) * (1 - p);
    cumulative += term;
  }
  return Math.max(0, 1 - cumulative);
}

/**
 * Percentile rank of each value within the array, on 0..1.
 * Tied values share the average of the ranks they span, so the result never
 * depends on input ordering.
 */
export function percentileRanks(values) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];

  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const out = new Array(n);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const averageRank = (i + j) / 2;
    for (let k = i; k <= j; k++) out[order[k]] = averageRank / (n - 1);
    i = j + 1;
  }
  return out;
}
