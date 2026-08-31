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
