import { COMPONENTS } from './config.js';
import { median } from './stats.js';
import { expectedPoints, playerComponents, shrunkRates, attackQuality, defenceQuality } from './model.js';
import { componentPercentiles, fixtureFactor, qualifiedPool, weightedScore } from './score.js';

const RATE_KEYS = ['xg90', 'xa90', 'xgc90', 'dc90', 'saves90'];

/** Build the ranked board for one position from a players.json payload. */
export function buildBoard(payload, position, weights, horizon) {
  const players = payload.players.filter((p) => p.position === position);
  if (!players.length) return [];

  const matchesByTeam = payload.team_matches_played || {};
  const maxMatches = Math.max(0, ...Object.values(matchesByTeam).map(Number));
  const pool = qualifiedPool(players, maxMatches * 90);

  const medians = {};
  for (const key of RATE_KEYS) medians[key] = median(pool.map((p) => p[key]));
  medians.minutes = median(pool.map((p) => p.minutes / Math.max(matchesByTeam[p.team] ?? 1, 1)));

  const rows = players.map((player) => {
    const teamMatches = Number(matchesByTeam[player.team] ?? 0);
    const ctx = {
      teamMatches,
      medians,
      fixtureFactor: fixtureFactor(payload.fixtures, player.team, horizon),
    };
    const components = playerComponents(player, ctx);
    const rates = shrunkRates(player, medians);
    const quality = attackQuality(rates, position) + defenceQuality(rates, position);
    const bonusPerMatch = teamMatches > 0 ? player.bonus / teamMatches : 0;

    return {
      ...player,
      components,
      expectedMinutes: components.minutes,
      xp: expectedPoints(quality, components.minutes, bonusPerMatch),
    };
  });

  // Percentiles are computed over the fixed qualified pool, never the filtered view (spec 6.8).
  const poolIds = new Set(pool.map((p) => p.id));
  const poolRows = rows.filter((r) => poolIds.has(r.id));
  const poolPercentiles = componentPercentiles(poolRows.map((r) => r.components), COMPONENTS);
  const byId = new Map(poolRows.map((r, i) => [r.id, poolPercentiles[i]]));

  const fallback = Object.fromEntries(COMPONENTS.map((k) => [k, 0]));
  for (const row of rows) {
    row.percentiles = byId.get(row.id) ?? fallback;
    row.score = weightedScore(row.percentiles, weights);
  }

  return rows.sort((a, b) => b.score - a.score);
}
