import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intervalDays, newMemory, preview, retrievability, review } from '../server/fsrs.ts';

const day = 864e5;
const t0 = new Date('2026-01-01T09:00:00Z');

test('recall chance is 90% after one stability interval', () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.equal(intervalDays(10), 10);
});

test('first ratings: Again and Hard stay in the session, Good and Easy wait days', () => {
  const p = preview(newMemory(), t0);
  assert.equal(p[1], 10 * 60e3);
  assert.equal(p[2], 5 * 60e3);
  assert.equal(Math.round(p[3] / day), 4);
  assert.equal(Math.round(p[4] / day), 14);
});

test('intervals grow with each Good review on time', () => {
  let m = newMemory();
  let now = t0;
  const gaps: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = review(m, 3, now);
    gaps.push(Math.round((r.due.getTime() - now.getTime()) / day));
    m = r.memory;
    now = r.due;
  }
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], `gaps ${gaps}`);
});

test('forgetting a review card counts a lapse and shrinks stability', () => {
  const first = review(newMemory(), 3, t0);
  const later = review(first.memory, 3, first.due);
  const lapse = review(later.memory, 1, later.due);
  assert.equal(lapse.memory.state, 'relearning');
  assert.equal(lapse.memory.lapses, 1);
  assert.ok(lapse.memory.stability < later.memory.stability);
  assert.ok(lapse.memory.difficulty > later.memory.difficulty);
});
