import { test } from 'node:test';
import assert from 'node:assert';
import { availability, expectedMinutes } from '../src/model.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} !== ${b}`);

test('available player with no flag has full availability', () => {
  close(availability({ status: 'a', chance_of_playing: null }), 1);
});

test('available player with a percentage uses it', () => {
  close(availability({ status: 'a', chance_of_playing: 75 }), 0.75);
});

test('injured player with no percentage is unavailable', () => {
  close(availability({ status: 'i', chance_of_playing: null }), 0);
});

test('doubtful player uses the stated chance', () => {
  close(availability({ status: 'd', chance_of_playing: 50 }), 0.5);
});

test('expectedMinutes shrinks toward the position median', () => {
  // 2 matches, 180 minutes played, median 45 per match, K_MATCHES = 1
  // (2 * 90 + 1 * 45) / 3 = 75
  const player = { minutes: 180, status: 'a', chance_of_playing: null };
  close(expectedMinutes(player, 2, 45), 75);
});

test('expectedMinutes is scaled by availability', () => {
  const player = { minutes: 180, status: 'd', chance_of_playing: 50 };
  close(expectedMinutes(player, 2, 45), 37.5);
});

test('expectedMinutes is zero for an unavailable player', () => {
  const player = { minutes: 180, status: 'i', chance_of_playing: null };
  close(expectedMinutes(player, 2, 45), 0);
});

test('expectedMinutes does not divide by zero before any match is played', () => {
  const player = { minutes: 0, status: 'a', chance_of_playing: null };
  const result = expectedMinutes(player, 0, 45);
  assert.ok(Number.isFinite(result), `got ${result}`);
});

import { attackQuality, defenceQuality, setPieceScore, expectedPoints, playerComponents, shrunkRates } from '../src/model.js';
import { GK, DEF, MID, FWD } from '../src/config.js';

const rates = { xg90: 0.2, xa90: 0.3, xgc90: 1.2, dc90: 9.0, saves90: 0.0 };

test('attackQuality prices goals and assists by position', () => {
  // MID: 0.2 * 5 + 0.3 * 3 = 1.9
  close(attackQuality(rates, MID), 1.9);
  // FWD goals are worth 4: 0.2 * 4 + 0.9 = 1.7
  close(attackQuality(rates, FWD), 1.7);
});

test('attackQuality does not scale by minutes', () => {
  // Same rates must give the same quality regardless of any minutes context.
  close(attackQuality(rates, MID), attackQuality({ ...rates }, MID));
});

test('goalkeepers get no DefCon contribution', () => {
  const withActions = defenceQuality({ ...rates, dc90: 20 }, GK);
  const without = defenceQuality({ ...rates, dc90: 0 }, GK);
  close(withActions, without);
});

test('defenders do get a DefCon contribution', () => {
  const high = defenceQuality({ ...rates, dc90: 14 }, DEF);
  const low = defenceQuality({ ...rates, dc90: 2 }, DEF);
  assert.ok(high > low, `${high} should exceed ${low}`);
});

test('forwards get no clean-sheet value', () => {
  const a = defenceQuality({ ...rates, xgc90: 0.2 }, FWD);
  const b = defenceQuality({ ...rates, xgc90: 3.0 }, FWD);
  close(a, b);   // FWD cs_points is 0 and they take no conceded penalty
});

test('conceding more reduces defender quality', () => {
  const tight = defenceQuality({ ...rates, xgc90: 0.5 }, DEF);
  const leaky = defenceQuality({ ...rates, xgc90: 2.5 }, DEF);
  assert.ok(tight > leaky);
});

test('setPieceScore takes the best duty and halves for second choice', () => {
  close(setPieceScore({ penalties_order: 1, direct_freekicks_order: null, corners_order: 1 }), 1.0);
  close(setPieceScore({ penalties_order: 2, direct_freekicks_order: null, corners_order: null }), 0.5);
  close(setPieceScore({ penalties_order: null, direct_freekicks_order: null, corners_order: 1 }), 0.3);
});

test('setPieceScore is zero for third choice or lower', () => {
  close(setPieceScore({ penalties_order: 3, direct_freekicks_order: 4, corners_order: 5 }), 0);
});

test('setPieceScore is zero when a player takes nothing', () => {
  close(setPieceScore({ penalties_order: null, direct_freekicks_order: null, corners_order: null }), 0);
});

test('expectedPoints scales quality by minutes and adds appearance points', () => {
  // quality 4, 85 expected minutes -> p60 = 1, f = 85/90
  const xp = expectedPoints(4, 85, 0);
  close(xp, 2 + 4 * (85 / 90));
});

test('expectedPoints falls as expected minutes fall', () => {
  const full = expectedPoints(4, 85, 0);
  const partial = expectedPoints(4, 40, 0);
  assert.ok(full > partial);
});

test('expectedPoints is zero-ish for a player expected not to feature', () => {
  close(expectedPoints(4, 0, 0), 0);
});

test('playerComponents returns every component key', () => {
  const player = { ...rates, position: DEF, minutes: 180, status: 'a', chance_of_playing: null,
                   form: 4.0, penalties_order: null, direct_freekicks_order: null, corners_order: null };
  const medians = { xg90: 0.1, xa90: 0.15, xgc90: 1.4, dc90: 7.4, saves90: 0, minutes: 90 };
  const ctx = { teamMatches: 2, medians, fixtureFactor: 1.5 };
  const c = playerComponents(player, ctx);
  for (const key of ['attack', 'defence', 'minutes', 'fixture', 'form', 'setPieces']) {
    assert.ok(key in c, `missing ${key}`);
    assert.ok(Number.isFinite(c[key]), `${key} is not finite: ${c[key]}`);
  }
});

test('shrunkRates throws rather than silently skipping shrinkage', () => {
  // Shrinkage is the safeguard against small-sample outliers. If a median goes
  // missing it must fail loudly, not quietly rank a one-minute player at the top.
  assert.throws(
    () => shrunkRates({ ...rates, minutes: 1 }, { minutes: 90 }),
    /missing median/,
  );
});

// --- survivor 2: CS_CALIBRATION ---
// The existing clean-sheet tests only check direction (tight > leaky), not that
// calibration is applied.  Removing CS_CALIBRATION (setting it to 1.0) shifts the
// GK/DEF clean-sheet probability but the direction tests still pass.
import { CS_CALIBRATION, CS_POINTS, GK as GK2, DEF as DEF2 } from '../src/config.js';

test('defenceQuality applies CS_CALIBRATION — removing it changes the result by >1%', () => {
  // For a MID: no conceded penalty, no saves — defenceQuality is almost entirely the CS term.
  // CS_CALIBRATION = 0.93 means exp(-xgc * 0.93) > exp(-xgc * 1.0) — less discounting of
  // clean-sheet probability.  The calibration was fitted to correct a measured -9% bias.
  const r = { xg90: 0, xa90: 0, xgc90: 1.2, dc90: 0, saves90: 0 };

  // Compute the full defenceQuality with CS_CALIBRATION applied (the actual function).
  const calibrated = defenceQuality(r, MID);  // MID: no conceded penalty, no saves

  // Compute what defenceQuality would be with calibration set to 1.0 (no bias correction).
  // MID CS_POINTS = 1, no conceded, no saves, no DefCon (dc90=0).
  const uncalibrated = Math.exp(-1.2 * 1.0) * CS_POINTS[MID];

  // With 0.93 < 1.0: less negative exponent → higher CS probability → calibrated > uncalibrated.
  assert.ok(calibrated > uncalibrated,
    `CS_CALIBRATION (0.93) should raise the clean-sheet probability vs no calibration. ` +
    `got calibrated=${calibrated.toFixed(4)}, uncalibrated=${uncalibrated.toFixed(4)}`);

  // The difference must be meaningful (>2%) — a trivial delta suggests calibration isn't applied.
  assert.ok(calibrated - uncalibrated > 0.02,
    `CS_CALIBRATION difference should exceed 0.02. Got: ${(calibrated - uncalibrated).toFixed(4)}`);
});

// --- survivor 3: conceded penalty sign ---
// The existing test only checks that tight > leaky for defenders (direction).
// Flipping the sign (conceded = +xgc/2 instead of -xgc/2) keeps quality decreasing
// with xgc because the CS term dominates — the direction tests pass either way.
// The unambiguous test: at very high xgc90 (4.0) the correct formula makes total
// quality NEGATIVE (conceded penalty -2.0 overwhelms the tiny CS term ~0.10),
// while the flipped formula gives +2.1.  Negative quality is the correct,
// physically-meaningful output: a leaky team destroys defensive value.
test('defenceQuality is negative for extremely leaky defenders — conceded sign must be negative', () => {
  // DEF, xgc90=4: CS = exp(-4*0.93)*4 ≈ 0.097, conceded [correct] = -2.0.
  // Total [correct] ≈ -1.90.  Total [flipped] ≈ +2.10.
  const result = defenceQuality({ xg90: 0, xa90: 0, xgc90: 4.0, dc90: 0, saves90: 0 }, DEF2);
  assert.ok(result < 0,
    `defenceQuality at xgc90=4 should be negative (CS ≈ 0.10, conceded penalty = -2.0). ` +
    `Got ${result.toFixed(4)}. If positive, the conceded sign is flipped.`);
});
