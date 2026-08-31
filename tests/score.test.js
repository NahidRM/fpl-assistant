import { test } from 'node:test';
import assert from 'node:assert';
import { fixtureFactor, qualifiedPool, weightedScore } from '../src/score.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} !== ${b}`);

const FIXTURES = [
  { event: 3, team_h: 1, team_a: 2, team_h_difficulty: 3, team_a_difficulty: 2, finished_provisional: false },
  { event: 4, team_h: 2, team_a: 1, team_h_difficulty: 2, team_a_difficulty: 3, finished_provisional: false },
  { event: 4, team_h: 1, team_a: 3, team_h_difficulty: 2, team_a_difficulty: 4, finished_provisional: false },
];

test('fixtureFactor sums ease across the horizon', () => {
  // Team 1 in GW3 has difficulty 3 -> (6-3)/3 = 1
  close(fixtureFactor(FIXTURES, 1, 1), 1);
});

test('a double gameweek contributes both matches', () => {
  // Team 1 across GW3 and GW4 plays three times total: difficulties 3, 3, 2
  const factor = fixtureFactor(FIXTURES, 1, 2);
  close(factor, (6 - 3) / 3 + (6 - 3) / 3 + (6 - 2) / 3);
});

test('a team with no upcoming fixtures scores zero', () => {
  close(fixtureFactor(FIXTURES, 99, 5), 0);
});

test('finished fixtures are excluded', () => {
  const played = [{ event: 1, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 2, finished_provisional: true }];
  close(fixtureFactor(played, 1, 5), 0);
});

test('qualifiedPool uses a floor of 90 minutes early in the season', () => {
  const players = [{ minutes: 100 }, { minutes: 50 }, { minutes: 200 }];
  assert.equal(qualifiedPool(players, 180, { minPool: 1 }).length, 2);
});

test('qualifiedPool threshold scales as the season progresses', () => {
  // 3420 available minutes (38 matches) -> threshold is 855, not 90
  const players = [{ minutes: 900 }, { minutes: 500 }, { minutes: 100 }];
  assert.equal(qualifiedPool(players, 3420, { minPool: 1 }).length, 1);
});

test('qualifiedPool falls back to the top 30 when too few qualify', () => {
  const players = Array.from({ length: 40 }, (_, i) => ({ minutes: i }));
  const pool = qualifiedPool(players, 100000);
  assert.equal(pool.length, 30);
  assert.equal(pool[0].minutes, 39, 'fallback must take the highest-minutes players');
});

test('weightedScore renormalizes weights that do not sum to one', () => {
  const components = { attack: 1, defence: 0 };
  close(weightedScore(components, { attack: 50, defence: 50 }), 0.5);
  close(weightedScore(components, { attack: 10, defence: 10 }), 0.5);
});

test('weightedScore respects the balance between components', () => {
  const components = { attack: 1, defence: 0 };
  close(weightedScore(components, { attack: 75, defence: 25 }), 0.75);
});

test('weightedScore falls back to equal weights when all are zero', () => {
  const components = { attack: 1, defence: 0 };
  close(weightedScore(components, { attack: 0, defence: 0 }), 0.5);
});

test('weightedScore ignores components with no weight entry', () => {
  const components = { attack: 1, defence: 0, extra: 99 };
  close(weightedScore(components, { attack: 1, defence: 1 }), 0.5);
});
