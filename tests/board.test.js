import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildBoard } from '../src/board.js';
import { DEF, MID, DEFAULT_WEIGHTS, DEFAULT_HORIZON } from '../src/config.js';

const payload = JSON.parse(readFileSync('tests/fixtures/players.sample.json', 'utf8'));

test('buildBoard returns players sorted by score descending', () => {
  const board = buildBoard(payload, DEF, DEFAULT_WEIGHTS[DEF], DEFAULT_HORIZON);
  for (let i = 1; i < board.length; i++) {
    assert.ok(board[i - 1].score >= board[i].score, 'board must be sorted');
  }
});

test('every row carries a finite score and expected points', () => {
  const board = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON);
  for (const row of board) {
    assert.ok(Number.isFinite(row.score), `score not finite for ${row.name}`);
    assert.ok(Number.isFinite(row.xp), `xp not finite for ${row.name}`);
    assert.ok(row.score >= 0 && row.score <= 1, `score out of range: ${row.score}`);
  }
});

test('changing weights changes the ordering', () => {
  const attackHeavy = buildBoard(payload, MID, { attack: 100, defence: 0, minutes: 0, fixture: 0, form: 0, setPieces: 0 }, DEFAULT_HORIZON);
  const minutesHeavy = buildBoard(payload, MID, { attack: 0, defence: 0, minutes: 100, fixture: 0, form: 0, setPieces: 0 }, DEFAULT_HORIZON);
  assert.notDeepEqual(attackHeavy.map((r) => r.id), minutesHeavy.map((r) => r.id),
    'sliders must actually change the board');
});

test('players ruled out score zero on minutes', () => {
  const board = buildBoard(payload, DEF, DEFAULT_WEIGHTS[DEF], DEFAULT_HORIZON);
  const ruledOut = board.filter((r) => r.chance_of_playing === 0);
  // Guard: without this the test passes vacuously if the fixture has no such player.
  // Real payloads set chance_of_playing to 0/25/50/75 for unavailable players, never null,
  // so filtering on `chance_of_playing === null` matched nothing and proved nothing.
  assert.ok(ruledOut.length > 0, 'fixture must contain at least one ruled-out player');
  for (const row of ruledOut) {
    assert.equal(row.expectedMinutes, 0, `${row.name} should have zero expected minutes`);
  }
});

test('the shrinkage slider actually changes the board', () => {
  // D14 exposes K as a control so its effect is visible. A dead slider is worse
  // than no slider: index.html had one that app.js never wired.
  const low = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON, 50);
  const high = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON, 1600);
  assert.notDeepEqual(low.map((r) => r.id), high.map((r) => r.id),
    'changing K must reorder the board, otherwise the control is decorative');
});

test('buildBoard defaults to the configured K when none is passed', () => {
  const explicit = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON, 400);
  const implicit = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON);
  assert.deepEqual(implicit.map((r) => r.id), explicit.map((r) => r.id));
});

// --- survivor 4: percentiles over pool not all rows ---
// buildBoard computes percentiles over the qualified pool (spec §6.8), not all rows.
// The mutant `const poolRows = rows` includes every player regardless of minutes.
// Effect: out-of-pool players drag percentile curves down, inflating scores for
// high-quality players who feature and deflating scores for the pool itself.
//
// Contract to pin: a player NOT in the pool must receive the fallback percentile
// (0 for every component), not a percentile derived from their own raw components.
test('out-of-pool players receive the fallback percentile, not their raw component rank', () => {
  // The qualified pool is the top-30 MIDs by minutes in the sample fixture.
  // Nelson (id:24, 0 mins) is outside the top-30 and must get the fallback (all-zero) percentiles.
  // If the mutant sets poolRows = rows (all rows), Nelson gets a real non-zero percentile.
  const board = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON);
  const nelson = board.find((r) => r.id === 24);
  assert.ok(nelson, 'Nelson (id:24) must be in the MID board (he is in the sample fixture)');

  const allZero = Object.values(nelson.percentiles).every((v) => v === 0);
  assert.ok(allZero,
    `Nelson (non-pool) should have all-zero percentiles. Got: ${JSON.stringify(nelson.percentiles)}`);
});

// --- survivor 5: K changes xP, not just ordering ---
// The existing K test checks that K=50 vs K=1600 reorders the board.
// But if K is only used in shrunkRates for scoring yet the xp column ignores K,
// the ordering can still change (via score) while xp is wrong.
// Pin: xP for a player with very few minutes must differ between extreme K values.
test('changing K changes xP for a low-minutes player, not just board ordering', () => {
  const low  = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON, 50);
  const high = buildBoard(payload, MID, DEFAULT_WEIGHTS[MID], DEFAULT_HORIZON, 1600);
  // Saka has 67 minutes — shrinkage toward the median is strongest for low-minute players.
  const sakaLow  = low.find((r) => r.name === 'Saka');
  const sakaHigh = high.find((r) => r.name === 'Saka');
  assert.ok(sakaLow && sakaHigh, 'Saka must appear in both boards');
  // xP = 2*p60 + quality*minutesFactor + bonus.  The quality term uses shrunkRates,
  // which is K-sensitive for low-minutes players. If K is ignored in shrunkRates the
  // quality term is the same regardless of K, so xP would be identical.
  assert.notEqual(sakaLow.xp.toFixed(6), sakaHigh.xp.toFixed(6),
    'xP must change with K for a low-minutes player; if it does not, K is ignored in the xP calculation');
});
