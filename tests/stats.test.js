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
