import { SHRINK_K, SHRINK_K_MATCHES, STARTER_MINUTES, CS_CALIBRATION,
         GOAL_POINTS, CS_POINTS, DEFCON_THRESHOLD, DEFCON_DISPERSION,
         SET_PIECE_WEIGHTS, GK, DEF } from './config.js';
import { shrink, negBinomAtLeast } from './stats.js';

/** 1 when fit and flagless, the stated chance when flagged, 0 when out. */
export function availability(player) {
  if (player.chance_of_playing !== null && player.chance_of_playing !== undefined) {
    return player.chance_of_playing / 100;
  }
  return player.status === 'a' ? 1 : 0;
}

/**
 * Expected minutes in the next match, from actual minutes played (spec D24),
 * shrunk over matches toward the position median and scaled by availability.
 */
export function expectedMinutes(player, teamMatches, medianMinutesPerMatch) {
  const matches = Math.max(teamMatches, 0);
  const perMatch = matches > 0 ? player.minutes / matches : 0;
  const shrunk =
    (matches * perMatch + SHRINK_K_MATCHES * medianMinutesPerMatch) /
    (matches + SHRINK_K_MATCHES);
  return shrunk * availability(player);
}

/** Attacking points per 90 minutes. Deliberately minutes-free (spec D23). */
export function attackQuality(rates, position) {
  return rates.xg90 * GOAL_POINTS[position] + rates.xa90 * 3;
}

/** Defensive points per 90 minutes: clean sheet, conceded, saves, DefCon. */
export function defenceQuality(rates, position) {
  const isKeeperOrDefender = position === GK || position === DEF;

  const cleanSheet = Math.exp(-rates.xgc90 * CS_CALIBRATION) * CS_POINTS[position];
  const conceded = isKeeperOrDefender ? -(rates.xgc90 / 2) : 0;
  const saves = position === GK ? rates.saves90 / 3 : 0;

  const threshold = DEFCON_THRESHOLD[position];
  const defcon = threshold === null
    ? 0
    : negBinomAtLeast(threshold, rates.dc90, DEFCON_DISPERSION[position]) * 2;

  return cleanSheet + conceded + saves + defcon;
}

/** Best set-piece duty a player holds; halved for second choice, zero below that. */
export function setPieceScore(player) {
  let best = 0;
  for (const [field, weight] of SET_PIECE_WEIGHTS) {
    const order = player[field];
    if (order === 1) best = Math.max(best, weight);
    else if (order === 2) best = Math.max(best, weight / 2);
  }
  return best;
}

/** Expected points in a single match: appearance plus minutes-scaled quality plus bonus. */
export function expectedPoints(quality, expMinutes, bonusPerMatch) {
  const p60 = Math.min(1, expMinutes / STARTER_MINUTES);
  const minutesFactor = expMinutes / 90;
  return 2 * p60 + quality * minutesFactor + bonusPerMatch;
}

/**
 * Shrink a player's raw rates toward the position medians.
 * A missing or non-finite median is no prior at all, so shrinking toward it is a
 * no-op on the player's own rate rather than a NaN that would poison the board.
 */
export function shrunkRates(player, medians) {
  const out = {};
  for (const key of ['xg90', 'xa90', 'xgc90', 'dc90', 'saves90']) {
    const prior = medians?.[key];
    if (!Number.isFinite(prior)) {
      // Deliberately loud. Shrinkage is what stops a one-minute player topping the
      // board; falling back silently would disable that safeguard invisibly.
      throw new Error(`shrunkRates: missing median for "${key}"`);
    }
    out[key] = shrink(player[key], player.minutes, prior, SHRINK_K);
  }
  return out;
}

/** The six slider components for one player. */
export function playerComponents(player, ctx) {
  const rates = shrunkRates(player, ctx.medians);
  return {
    attack: attackQuality(rates, player.position),
    defence: defenceQuality(rates, player.position),
    minutes: expectedMinutes(player, ctx.teamMatches, ctx.medians.minutes),
    fixture: ctx.fixtureFactor,
    form: player.form,
    setPieces: setPieceScore(player),
  };
}
