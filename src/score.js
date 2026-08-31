import { percentileRanks } from './stats.js';

/**
 * Fixture ease over the next N gameweeks, summed across matches (spec D22).
 * Counting gameweeks rather than fixtures is what makes a double gameweek score
 * roughly double and a blank gameweek score nothing.
 */
export function fixtureFactor(fixtures, teamId, horizonGameweeks) {
  const upcoming = fixtures
    .filter((f) => !f.finished_provisional && f.event !== null && f.event !== undefined)
    .filter((f) => f.team_h === teamId || f.team_a === teamId)
    .sort((a, b) => a.event - b.event);

  const gameweeks = new Set();
  let total = 0;
  for (const fixture of upcoming) {
    if (gameweeks.size >= horizonGameweeks && !gameweeks.has(fixture.event)) break;
    gameweeks.add(fixture.event);
    const difficulty = fixture.team_h === teamId ? fixture.team_h_difficulty : fixture.team_a_difficulty;
    total += (6 - difficulty) / 3;
  }
  return total;
}

/**
 * The fixed pool percentiles are computed over (spec 6.8). The threshold scales with
 * the season so it does not become meaningless once everyone clears 90 minutes.
 */
export function qualifiedPool(players, teamAvailableMinutes, { minPool = 10, fallbackSize = 30 } = {}) {
  const threshold = Math.max(90, 0.25 * teamAvailableMinutes);
  const qualified = players.filter((p) => p.minutes >= threshold);
  if (qualified.length >= minPool) return qualified;
  return [...players].sort((a, b) => b.minutes - a.minutes).slice(0, fallbackSize);
}

/** Convert a list of component objects into percentile-ranked equivalents. */
export function componentPercentiles(componentList, keys) {
  const ranked = {};
  for (const key of keys) {
    ranked[key] = percentileRanks(componentList.map((c) => c[key]));
  }
  return componentList.map((_, i) => {
    const row = {};
    for (const key of keys) row[key] = ranked[key][i];
    return row;
  });
}

/**
 * Weighted sum, renormalized by the sum of weights (spec D21), so dragging one
 * slider cannot silently rescale the board. All-zero weights fall back to equal.
 */
export function weightedScore(components, weights) {
  const keys = Object.keys(weights);
  const total = keys.reduce((sum, key) => sum + weights[key], 0);
  if (total <= 0) {
    return keys.reduce((sum, key) => sum + (components[key] ?? 0), 0) / keys.length;
  }
  return keys.reduce((sum, key) => sum + weights[key] * (components[key] ?? 0), 0) / total;
}
