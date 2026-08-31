# FPL Assistant — Frontend & Scoring Model Implementation Plan (2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser-side scoring model and dashboard that read `data/players.json` and rank players by position, with live weighting sliders and filters.

**Architecture:** Six ES modules with one responsibility each. `stats.js` holds pure maths primitives with no domain knowledge; `model.js` turns a raw player record into expected points and components; `score.js` handles pooling, percentiles and the weighted sum; `ui.js` owns all DOM; `app.js` wires state together; `config.js` holds every constant so no magic number is buried in logic. Everything except `ui.js` and `app.js` is a pure function and is unit tested.

**Tech Stack:** Vanilla ES modules, no framework, no build step. `node:test` for tests (zero dependencies). Served as static files by GitHub Pages.

**Depends on:** Plan 1's `players.json` contract. Build Plan 1 first.

**Spec:** `docs/superpowers/specs/2026-08-29-fpl-assistant-design.md` — §6, §7, §8, §9.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/config.js` | Every constant: weights, point tables, thresholds, K, dispersion, calibration. |
| `src/stats.js` | Pure maths: shrinkage, Poisson, negative binomial, median, percentile ranks. No FPL knowledge. |
| `src/model.js` | Expected minutes, expected points, and the six components per player. |
| `src/score.js` | Qualified pool, percentile conversion, weighted sum with renormalization. |
| `src/ui.js` | All DOM rendering: tabs, table, sliders, badges, banners. |
| `src/app.js` | State, data loading, event wiring. |
| `src/styles.css` | Desktop-first layout; columns wrap and sliders stack on narrow screens. |
| `index.html` | Page shell. |
| `tests/*.test.js` | `node:test` suites. |

**Key design point (spec D23):** quality components are evaluated **at a full 90 minutes** and
Minutes security carries the volume separately. Measured, this dropped the Attack/Minutes
correlation from 0.77 to 0.18. Expected points is still quality x minutes — only the sliders
are independent.

---

## Task 1: Scaffolding and test harness

**Files:**
- Create: `package.json`, `tests/fixtures/players.sample.json`

- [ ] **Step 1: Create package.json**

`type: module` is required for ES module imports in tests. There are no dependencies.

The test script uses bare `node --test` auto-discovery. Do **not** write `node --test tests/`:
Node 25 no longer expands a directory argument and tries to load `tests` as a module file,
which fails before it reaches any test.

```json
{
  "name": "fpl-assistant",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create a sample players.json fixture**

Run this after Plan 1's pipeline exists, to capture a real trimmed payload:

```bash
mkdir -p tests/fixtures
python3 -c "
import json
d = json.load(open('data/players.json'))
d['players'] = d['players'][:80]
json.dump(d, open('tests/fixtures/players.sample.json','w'))
print('sample has', len(d['players']), 'players')
"
```
Expected: `sample has 80 players`

- [ ] **Step 3: Verify the test runner works**

```bash
mkdir -p tests && printf "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('harness works', () => assert.equal(1, 1));\n" > tests/smoke.test.js
npm test
```
Expected: `# pass 1`

- [ ] **Step 4: Commit**

```bash
git add package.json tests/
git commit -m "chore: add node:test harness and sample payload fixture"
```

---

## Task 2: config.js — every constant in one place

Values come from spec §6.3, §6.6, §6.9 and §13.7. Goalkeepers have `defcon: null` because
they earn no DefCon points at all (D28, verified: every GK has `defensive_contribution` of 0).

**Files:**
- Create: `src/config.js`

- [ ] **Step 1: Write config.js**

```javascript
// Positions as FPL numbers them.
export const GK = 1;
export const DEF = 2;
export const MID = 3;
export const FWD = 4;

export const SHRINK_K = 400;          // minutes of league-average mixed in (spec 6.1)
export const SHRINK_K_MATCHES = 1;    // matches of prior for the minutes estimate (spec 6.2)
export const STARTER_MINUTES = 85;    // typical minutes for a player who starts
export const CS_CALIBRATION = 0.93;   // corrects the measured -9% clean-sheet bias (D26)

export const GOAL_POINTS  = { [GK]: 6, [DEF]: 6, [MID]: 5, [FWD]: 4 };
export const CS_POINTS    = { [GK]: 4, [DEF]: 4, [MID]: 1, [FWD]: 0 };

// null = position earns no DefCon points. Verified for goalkeepers (D28).
export const DEFCON_THRESHOLD = { [GK]: null, [DEF]: 10, [MID]: 12, [FWD]: 12 };

// Negative binomial dispersion, fitted from measured variance-to-mean (spec 13.7).
// Infinity falls back to Poisson: forwards measured 0.93, i.e. not overdispersed.
export const DEFCON_DISPERSION = { [GK]: Infinity, [DEF]: 5.79, [MID]: 10.21, [FWD]: Infinity };

export const COMPONENTS = ['attack', 'defence', 'minutes', 'fixture', 'form', 'setPieces'];

// Default slider weights, per spec 6.9. Each column sums to 100.
export const DEFAULT_WEIGHTS = {
  [GK]:  { attack: 0,  defence: 45, minutes: 20, fixture: 10, form: 25, setPieces: 0 },
  [DEF]: { attack: 10, defence: 30, minutes: 20, fixture: 10, form: 15, setPieces: 15 },
  [MID]: { attack: 35, defence: 5,  minutes: 20, fixture: 15, form: 15, setPieces: 10 },
  [FWD]: { attack: 40, defence: 0,  minutes: 20, fixture: 15, form: 15, setPieces: 10 },
};

export const SET_PIECE_WEIGHTS = [
  ['penalties_order', 1.0],
  ['direct_freekicks_order', 0.5],
  ['corners_order', 0.3],
];

export const POSITION_NAMES = { [GK]: 'Goalkeepers', [DEF]: 'Defenders', [MID]: 'Midfielders', [FWD]: 'Forwards' };
export const FIXTURE_HORIZONS = [3, 5, 8];
export const DEFAULT_HORIZON = 5;
export const NOISY_UNTIL_GAMEWEEK = 6;   // sample-size banner threshold (spec 7)
```

- [ ] **Step 2: Verify the weights sum correctly**

```bash
node -e "
import('./src/config.js').then(c => {
  for (const [pos, w] of Object.entries(c.DEFAULT_WEIGHTS)) {
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    console.log('position', pos, 'sums to', sum);
    if (sum !== 100) process.exit(1);
  }
  console.log('all weight sets sum to 100');
});
"
```
Expected: four lines each `sums to 100`, then `all weight sets sum to 100`

- [ ] **Step 3: Commit**

```bash
git add src/config.js
git commit -m "feat: add scoring constants and default weights"
```

---

## Task 3: stats.js — shrinkage and distributions

**Files:**
- Create: `src/stats.js`
- Test: `tests/stats.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/stats.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { shrink, median, poissonAtLeast, negBinomAtLeast } from '../src/stats.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} !== ${b}`);

test('shrink pulls a rate toward the median in proportion to minutes', () => {
  // 180 minutes with K=400 gives the player's own data 180/580 of the weight.
  close(shrink(13.5, 180, 7.38, 400), (180 * 13.5 + 400 * 7.38) / 580);
});

test('shrink returns the median when minutes are zero', () => {
  close(shrink(99, 0, 7, 400), 7);
});

test('shrink approaches the raw rate as minutes grow large', () => {
  assert.ok(Math.abs(shrink(10, 100000, 2, 400) - 10) < 0.05);
});

test('median handles odd and even lengths', () => {
  close(median([3, 1, 2]), 2);
  close(median([4, 1, 3, 2]), 2.5);
});

test('median of an empty list is zero', () => {
  close(median([]), 0);
});

test('poissonAtLeast matches a hand-computed value', () => {
  // mean 1.46: P(0)=e^-1.46=0.232, so P(>=1)=0.768
  close(poissonAtLeast(1, 1.46), 1 - Math.exp(-1.46), 1e-9);
});

test('poissonAtLeast is zero for a zero mean', () => {
  close(poissonAtLeast(10, 0), 0);
});

test('poissonAtLeast decreases as the threshold rises', () => {
  const a = poissonAtLeast(5, 9.28), b = poissonAtLeast(10, 9.28), c = poissonAtLeast(15, 9.28);
  assert.ok(a > b && b > c);
});

test('negBinomAtLeast exceeds Poisson at the same mean when overdispersed', () => {
  // This is the whole point of D27: Poisson understates the upper tail.
  const nb = negBinomAtLeast(10, 7.20, 5.79);
  const po = poissonAtLeast(10, 7.20);
  assert.ok(nb > po, `expected NB ${nb} > Poisson ${po}`);
});

test('negBinomAtLeast reproduces the measured defender figure', () => {
  // Spec 13.7: mean 7.20, r 5.79, threshold 10 -> about 25%
  const p = negBinomAtLeast(10, 7.20, 5.79);
  assert.ok(p > 0.22 && p < 0.28, `got ${p}`);
});

test('negBinomAtLeast falls back to Poisson for infinite dispersion', () => {
  close(negBinomAtLeast(12, 4.38, Infinity), poissonAtLeast(12, 4.38), 1e-9);
});

test('negBinomAtLeast is zero for a zero mean', () => {
  close(negBinomAtLeast(10, 0, 5.79), 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/stats.js'`

- [ ] **Step 3: Write the implementation**

Create `src/stats.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 12 stats tests passing

- [ ] **Step 5: Commit**

```bash
git add src/stats.js tests/stats.test.js
git commit -m "feat: add shrinkage, Poisson and negative binomial primitives"
```

---

## Task 4: stats.js — percentile ranks with ties

Spec §6.8. Ties matter: many players share identical zero values, and breaking ties by array
order would make the ranking depend on payload ordering.

**Files:**
- Modify: `src/stats.js`
- Modify: `tests/stats.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/stats.test.js`:

```javascript
import { percentileRanks } from '../src/stats.js';

test('percentileRanks spans zero to one', () => {
  const p = percentileRanks([10, 20, 30, 40, 50]);
  close(p[0], 0);
  close(p[4], 1);
});

test('percentileRanks is independent of input order', () => {
  const a = percentileRanks([3, 1, 2]);
  const b = percentileRanks([1, 2, 3]);
  close(a[1], b[0]);   // the value 1 ranks the same either way
  close(a[0], b[2]);   // and so does the value 3
});

test('percentileRanks gives tied values the same rank', () => {
  const p = percentileRanks([5, 5, 5, 9]);
  close(p[0], p[1]);
  close(p[1], p[2]);
  assert.ok(p[3] > p[0]);
});

test('percentileRanks handles a single player', () => {
  assert.deepEqual(percentileRanks([7]), [0.5]);
});

test('percentileRanks handles an empty pool', () => {
  assert.deepEqual(percentileRanks([]), []);
});

test('percentileRanks gives every value the same rank when all are identical', () => {
  const p = percentileRanks([4, 4, 4]);
  close(p[0], p[1]);
  close(p[1], p[2]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `percentileRanks is not a function` (or an import error)

- [ ] **Step 3: Write the implementation**

Append to `src/stats.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 18 stats tests passing

- [ ] **Step 5: Commit**

```bash
git add src/stats.js tests/stats.test.js
git commit -m "feat: add tie-aware percentile ranking"
```

---

## Task 5: model.js — availability and expected minutes

Spec §6.2 and D24. Expected minutes come from **actual minutes played**, not start count.

**Files:**
- Create: `src/model.js`
- Test: `tests/model.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/model.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/model.js'`

- [ ] **Step 3: Write the implementation**

Create `src/model.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 8 model tests passing

- [ ] **Step 5: Commit**

```bash
git add src/model.js tests/model.test.js
git commit -m "feat: add availability and expected-minutes estimation"
```

---

## Task 6: model.js — quality components and expected points

Spec §6.3 and D23. Quality is evaluated at a **full 90 minutes** so it stays independent of
Minutes security; expected points multiplies quality by minutes afterwards.

**Files:**
- Modify: `src/model.js`
- Modify: `tests/model.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/model.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `attackQuality is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/model.js`:

```javascript
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

/** Shrink a player's raw rates toward the position medians. */
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 22 model tests passing (40 in total with stats)

- [ ] **Step 5: Commit**

```bash
git add src/model.js tests/model.test.js
git commit -m "feat: add quality components and expected points per match"
```

---

## Task 7: score.js — pool, fixtures, and the weighted sum

Spec §6.7, §6.8, §6.9 and D21/D22.

**Files:**
- Create: `src/score.js`
- Test: `tests/score.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/score.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/score.js'`

- [ ] **Step 3: Write the implementation**

Create `src/score.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 11 score tests passing

- [ ] **Step 5: Commit**

```bash
git add src/score.js tests/score.test.js
git commit -m "feat: add fixture projection, qualified pool and weighted scoring"
```

---

## Task 8: Golden-output regression test

Spec §9. A maths change that silently reorders the board must fail loudly.

**Files:**
- Create: `src/board.js`
- Test: `tests/board.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/board.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/board.js'`

- [ ] **Step 3: Write the implementation**

Create `src/board.js`:

```javascript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all board tests passing

- [ ] **Step 5: Commit**

```bash
git add src/board.js tests/board.test.js
git commit -m "feat: assemble ranked board with fixed-pool percentiles"
```

---

## Task 9: index.html and styles.css

Spec §7 and D13: desktop-first, columns wrap and sliders stack on narrow screens.

**Files:**
- Create: `index.html`, `src/styles.css`

- [ ] **Step 1: Write index.html**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FPL Assistant</title>
  <link rel="stylesheet" href="src/styles.css">
</head>
<body>
  <header>
    <h1>FPL Assistant</h1>
    <p id="status-banner" class="banner" role="status">Loading…</p>
  </header>

  <nav id="tabs" class="tabs" role="tablist"></nav>

  <main>
    <section id="controls" class="controls">
      <div id="weights" class="weights"></div>
      <div class="filters">
        <label>Horizon <select id="horizon"></select></label>
        <label>Timeframe <select id="timeframe"></select></label>
        <label><input type="checkbox" id="hide-unavailable" checked> Hide unavailable</label>
        <label>Min minutes <input type="range" id="min-minutes" min="0" max="90" value="0"> <span id="min-minutes-value">0</span></label>
        <label>Max price <input type="range" id="max-price" min="38" max="150" value="150"> <span id="max-price-value">15.0</span></label>
        <button id="reset-weights" type="button">Reset weights</button>
      </div>
      <details class="advanced">
        <summary>Advanced</summary>
        <label>Shrinkage K <input type="range" id="shrink-k" min="50" max="1600" step="50" value="400"> <span id="shrink-k-value">400</span></label>
        <p class="note">K is a scepticism dial, not a fitted value. Higher K trusts small samples less.</p>
      </details>
    </section>

    <table id="board">
      <thead id="board-head"></thead>
      <tbody id="board-body"></tbody>
    </table>
  </main>

  <footer>
    <p id="footer-note"></p>
  </footer>

  <script type="module" src="src/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write styles.css**

```css
:root {
  --bg: #ffffff; --fg: #16181d; --muted: #6b7280;
  --line: #e5e7eb; --accent: #1d4ed8; --warn: #b45309; --bad: #b91c1c;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1115; --fg: #e6e8ec; --muted: #9aa1ad;
          --line: #262b33; --accent: #7aa2ff; --warn: #f0b45c; --bad: #f08a8a; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 1.5rem; background: var(--bg); color: var(--fg);
       font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.35rem; margin: 0 0 .5rem; }
.banner { margin: 0 0 1rem; padding: .5rem .75rem; border-left: 3px solid var(--warn);
          background: color-mix(in srgb, var(--warn) 10%, transparent); color: var(--fg); }
.banner.error { border-color: var(--bad); background: color-mix(in srgb, var(--bad) 12%, transparent); }
.tabs { display: flex; gap: .25rem; flex-wrap: wrap; border-bottom: 1px solid var(--line); }
.tabs button { border: 0; background: none; color: var(--muted); padding: .5rem .9rem;
               font: inherit; cursor: pointer; border-bottom: 2px solid transparent; }
.tabs button[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
.controls { display: grid; gap: 1rem; padding: 1rem 0; }
.weights { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: .6rem; }
.weight label { display: flex; align-items: center; gap: .5rem; font-size: .86rem; }
.weight input { flex: 1; }
.weight .pct { color: var(--muted); min-width: 3.2em; text-align: right; font-variant-numeric: tabular-nums; }
.filters { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; font-size: .86rem; }
.advanced { font-size: .86rem; color: var(--muted); }
.note { margin: .4rem 0 0; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: right; padding: .4rem .5rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
th:nth-child(-n+3), td:nth-child(-n+3) { text-align: left; }
th { cursor: pointer; font-weight: 600; font-size: .8rem; color: var(--muted); }
th[aria-sort] { color: var(--fg); }
.badge { display: inline-block; padding: 0 .35rem; border-radius: 3px; font-size: .72rem; margin-left: .3rem; }
.badge.out { background: color-mix(in srgb, var(--bad) 20%, transparent); color: var(--bad); }
.badge.doubt { background: color-mix(in srgb, var(--warn) 22%, transparent); color: var(--warn); }
.badge.outlier { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
footer { margin-top: 1.5rem; color: var(--muted); font-size: .8rem; }
@media (max-width: 720px) {
  body { padding: 1rem; }
  table { display: block; overflow-x: auto; }
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html src/styles.css
git commit -m "feat: add page shell and desktop-first stylesheet"
```

---

## Task 10: ui.js — rendering

**Files:**
- Create: `src/ui.js`

- [ ] **Step 1: Write ui.js**

```javascript
import { COMPONENTS, POSITION_NAMES, NOISY_UNTIL_GAMEWEEK } from './config.js';

const LABELS = {
  attack: 'Attack', defence: 'Defence', minutes: 'Minutes',
  fixture: 'Fixtures', form: 'Form', setPieces: 'Set pieces',
};

const COLUMNS = [
  // name and teamName come from the same untrusted API payload as news, so they
  // are escaped too. Numeric columns are safe: toFixed/String cannot emit markup.
  { key: 'name', label: 'Player', format: (r) => escapeHtml(r.name) + badges(r) },
  { key: 'teamName', label: 'Team', format: (r) => escapeHtml(r.teamName) },
  { key: 'price', label: 'Price', format: (r) => r.price.toFixed(1) },
  { key: 'score', label: 'Score', format: (r) => r.score.toFixed(3) },
  { key: 'xp', label: 'xP/match', format: (r) => r.xp.toFixed(2) },
  { key: 'valuePerMillion', label: 'xP per £m', format: (r) => r.valuePerMillion.toFixed(3) },
  { key: 'expectedMinutes', label: 'Exp mins', format: (r) => r.expectedMinutes.toFixed(0) },
  { key: 'minutes', label: 'Mins', format: (r) => String(r.minutes) },
  { key: 'form', label: 'Form', format: (r) => r.form.toFixed(1) },
  { key: 'xgi90', label: 'xGI/90', format: (r) => r.xgi90.toFixed(2) },
  { key: 'dc90', label: 'DC/90', format: (r) => r.dc90.toFixed(1) },
  { key: 'baseline', label: 'Pts/match', format: (r) => r.baseline.toFixed(2) },
];

function badges(row) {
  let out = '';
  if (row.status !== 'a') {
    const label = row.chance_of_playing === null ? 'OUT' : row.chance_of_playing + '%';
    const cls = row.chance_of_playing === null ? 'out' : 'doubt';
    out += ` <span class="badge ${cls}" title="${escapeHtml(row.news || '')}">${label}</span>`;
  }
  if (row.isOutlier) out += ' <span class="badge outlier" title="More than 2 SD above the position field">outlier</span>';
  return out;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderTabs(container, positions, active, onSelect) {
  container.innerHTML = '';
  for (const position of positions) {
    const button = document.createElement('button');
    button.textContent = POSITION_NAMES[position];
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(position === active));
    button.addEventListener('click', () => onSelect(position));
    container.appendChild(button);
  }
}

export function renderWeights(container, weights, onChange) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  container.innerHTML = '';
  for (const key of COMPONENTS) {
    const wrapper = document.createElement('div');
    wrapper.className = 'weight';
    const effective = ((weights[key] / total) * 100).toFixed(0);
    wrapper.innerHTML =
      `<label>${LABELS[key]}` +
      `<input type="range" min="0" max="100" value="${weights[key]}" data-key="${key}">` +
      `<span class="pct">${effective}%</span></label>`;
    wrapper.querySelector('input').addEventListener('input', (event) => {
      onChange(key, Number(event.target.value));
    });
    container.appendChild(wrapper);
  }
}

export function renderTable(head, body, rows, sortKey, onSort) {
  head.innerHTML = '';
  const headRow = document.createElement('tr');
  for (const column of COLUMNS) {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (column.key === sortKey) th.setAttribute('aria-sort', 'descending');
    th.addEventListener('click', () => onSort(column.key));
    headRow.appendChild(th);
  }
  head.appendChild(headRow);

  body.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const column of COLUMNS) {
      const td = document.createElement('td');
      td.innerHTML = column.format(row);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

export function renderBanner(element, payload, error) {
  element.classList.toggle('error', Boolean(error));
  if (error) {
    element.textContent = `Could not load player data: ${error}. The board cannot be shown.`;
    return;
  }
  const parts = [`Updated ${new Date(payload.generated_at).toLocaleString()}`];
  if (payload.current_gameweek !== null && payload.current_gameweek < NOISY_UNTIL_GAMEWEEK) {
    parts.push(`Only ${payload.current_gameweek} gameweek(s) played — treat rankings as noisy.`);
  }
  if (!payload.data_checked) parts.push('Latest gameweek is provisional; bonus points may change.');
  element.textContent = parts.join(' · ');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui.js
git commit -m "feat: add DOM rendering for tabs, weights, table and banner"
```

---

## Task 11: app.js — state and wiring

Spec §7 and §8: cache-busting on the fetch, and an explicit error state rather than an empty table.

**Files:**
- Create: `src/app.js`

- [ ] **Step 1: Write app.js**

```javascript
import { GK, DEF, MID, FWD, DEFAULT_WEIGHTS, DEFAULT_HORIZON, FIXTURE_HORIZONS } from './config.js';
import { buildBoard } from './board.js';
import { renderBanner, renderTabs, renderTable, renderWeights } from './ui.js';

const POSITIONS = [GK, DEF, MID, FWD];
const TIMEFRAMES = [
  { key: 'season', label: 'Season to date' },
  { key: 'last4', label: 'Last 4 GWs' },
  { key: 'last2', label: 'Last 2 GWs' },
];

const state = {
  payload: null,
  position: MID,
  weights: structuredClone(DEFAULT_WEIGHTS),
  horizon: DEFAULT_HORIZON,
  timeframe: 'season',
  hideUnavailable: true,
  minMinutes: 0,
  maxPrice: 15.0,
  sortKey: 'score',
};

const el = (id) => document.getElementById(id);

async function load() {
  // Cache-bust: the Pages CDN will otherwise serve stale JSON after a refresh (spec 7).
  const response = await fetch(`data/players.json?v=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function baselinePoints(player, teamMatches) {
  return teamMatches > 0 ? player.total_points / teamMatches : 0;
}

function visibleRows() {
  const board = buildBoard(state.payload, state.position, state.weights[state.position], state.horizon);
  const teams = new Map(state.payload.teams.map((t) => [t.id, t.short_name]));
  const matches = state.payload.team_matches_played || {};

  const scores = board.map((r) => r.xp);
  const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length || 1));

  return board
    .map((row) => {
      const teamMatches = Number(matches[row.team] ?? 0);
      return {
        ...row,
        teamName: teams.get(row.team) ?? '?',
        valuePerMillion: row.xp / row.price,
        baseline: baselinePoints(row, teamMatches),
        isOutlier: sd > 0 && row.xp > mean + 2 * sd,
      };
    })
    .filter((row) => {
      if (state.hideUnavailable && row.status !== 'a') return false;
      if (row.expectedMinutes < state.minMinutes) return false;
      if (row.price > state.maxPrice) return false;
      if (state.timeframe !== 'season' && !row[state.timeframe]) return false;
      return true;
    })
    .sort((a, b) => (b[state.sortKey] ?? 0) - (a[state.sortKey] ?? 0));
}

function render() {
  renderTabs(el('tabs'), POSITIONS, state.position, (position) => {
    state.position = position;
    render();
  });
  renderWeights(el('weights'), state.weights[state.position], (key, value) => {
    state.weights[state.position][key] = value;
    render();
  });
  renderTable(el('board-head'), el('board-body'), visibleRows(), state.sortKey, (key) => {
    state.sortKey = key;
    render();
  });
  el('footer-note').textContent =
    'Scores are percentiles within position, so they are not comparable across tabs. ' +
    'This model has not been shown to predict better than simple heuristics — see the README.';
}

function wireControls() {
  const horizon = el('horizon');
  horizon.innerHTML = FIXTURE_HORIZONS.map((n) => `<option value="${n}">${n} GWs</option>`).join('');
  horizon.value = String(state.horizon);
  horizon.addEventListener('change', () => { state.horizon = Number(horizon.value); render(); });

  const timeframe = el('timeframe');
  timeframe.innerHTML = TIMEFRAMES.map((t) => `<option value="${t.key}">${t.label}</option>`).join('');
  timeframe.addEventListener('change', () => { state.timeframe = timeframe.value; render(); });

  el('hide-unavailable').addEventListener('change', (event) => {
    state.hideUnavailable = event.target.checked;
    render();
  });

  el('min-minutes').addEventListener('input', (event) => {
    state.minMinutes = Number(event.target.value);
    el('min-minutes-value').textContent = event.target.value;
    render();
  });

  el('max-price').addEventListener('input', (event) => {
    state.maxPrice = Number(event.target.value) / 10;
    el('max-price-value').textContent = state.maxPrice.toFixed(1);
    render();
  });

  el('reset-weights').addEventListener('click', () => {
    state.weights[state.position] = { ...DEFAULT_WEIGHTS[state.position] };
    render();
  });
}

async function main() {
  try {
    state.payload = await load();
  } catch (error) {
    renderBanner(el('status-banner'), null, error.message);
    return;
  }
  renderBanner(el('status-banner'), state.payload, null);
  wireControls();
  render();
}

main();
```

- [ ] **Step 2: Serve locally and check it renders**

```bash
python3 -m http.server 8000
```
Then open `http://localhost:8000` and confirm: four tabs, six sliders showing effective
percentages, a populated table, and the updated-at banner. Stop the server with Ctrl-C.

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: wire state, filters and live re-scoring"
```

---

## Task 12: Enable GitHub Pages and finish the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Enable Pages from the default branch**

```bash
gh api -X POST repos/NahidRM/fpl-assistant/pages -f source[branch]=main -f source[path]=/ || echo "already enabled"
gh api repos/NahidRM/fpl-assistant/pages -q .html_url
```
Expected: `https://nahidrm.github.io/fpl-assistant/`

- [ ] **Step 2: Add the live link to the README**

Insert immediately below the `# FPL Assistant` heading:

```markdown
**Live:** https://nahidrm.github.io/fpl-assistant/
```

- [ ] **Step 3: Verify the deployed page loads its data**

Open the live URL and confirm the board renders and the banner shows a recent timestamp.
If the table is empty, check that `data/players.json` was committed by Plan 1.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add live site link"
git push
```

---

## Done when

- [ ] `npm test` passes across `stats`, `model`, `score` and `board` suites
- [ ] The local page renders four tabs, six sliders, and a sorted table
- [ ] Moving any slider reorders the board immediately, with effective percentages updating
- [ ] Filters change which rows show but never change a player's score (spec 6.8)
- [ ] The banner shows the last-updated time and the noisy-season warning
- [ ] The live GitHub Pages URL renders with committed data
- [ ] The footer carries the "not shown to predict better" note
