import { test } from 'node:test';
import assert from 'node:assert';
import { compareRows } from '../src/ui.js';

// --- sort comparator ---

test('compareRows sorts numeric columns descending (highest score first)', () => {
  const rows = [{ score: 0.3 }, { score: 0.9 }, { score: 0.1 }];
  const sorted = [...rows].sort((a, b) => compareRows(a, b, 'score'));
  assert.deepEqual(sorted.map(r => r.score), [0.9, 0.3, 0.1]);
});

test('compareRows sorts string columns A→Z instead of returning NaN', () => {
  const rows = [{ name: 'Salah' }, { name: 'Álvarez' }, { name: 'Bruno' }];
  const sorted = [...rows].sort((a, b) => compareRows(a, b, 'name'));
  // Should be alphabetical, not the original insertion order.
  assert.deepEqual(sorted.map(r => r.name), ['Álvarez', 'Bruno', 'Salah']);
});

test('compareRows on a string column never returns NaN', () => {
  const result = compareRows({ name: 'Salah' }, { name: 'Bruno' }, 'name');
  assert.ok(Number.isFinite(result) || result === 0,
    `compareRows returned ${result} for string keys — NaN makes Array.sort give undefined order`);
});

test('compareRows handles ?? fallback for missing numeric keys', () => {
  const rows = [{ xp: 4.5 }, { xp: undefined }, { xp: 6.0 }];
  const sorted = [...rows].sort((a, b) => compareRows(a, b, 'xp'));
  // Missing value falls back to 0, so order is 6.0, 4.5, 0
  assert.equal(sorted[0].xp, 6.0);
  assert.equal(sorted[1].xp, 4.5);
  assert.equal(sorted[2].xp, undefined);
});
