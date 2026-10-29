import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coveredSeconds, isDone, isPlayback, mergeSegments } from '../shared/segments.ts';

test('mergeSegments joins overlapping and near-touching ranges', () => {
  assert.deepEqual(mergeSegments([[10, 20], [0, 5], [5.5, 9], [15, 30]]), [[0, 30]]);
  assert.deepEqual(mergeSegments([[0, 5], [7, 9]]), [[0, 5], [7, 9]]);
});

test('mergeSegments drops empty, reversed and non-finite ranges', () => {
  assert.deepEqual(mergeSegments([[5, 5], [9, 3], [NaN, 4], [0, Infinity], [1, 2]]), [[1, 2]]);
});

test('mergeSegments does not mutate its input', () => {
  const input: [number, number][] = [[0, 5], [4, 10]];
  mergeSegments(input);
  assert.deepEqual(input, [[0, 5], [4, 10]]);
});

test('coveredSeconds clips to the video length', () => {
  assert.equal(coveredSeconds([[0, 50], [90, 130]], 100), 60);
  assert.equal(coveredSeconds([[-5, 10]], 100), 10);
  // Unknown length counts every range in full.
  assert.equal(coveredSeconds([[0, 50]], 0), 50);
});

test('isPlayback tells playback from seeks', () => {
  assert.equal(isPlayback(1, 1, 1), true);
  assert.equal(isPlayback(2, 1, 2), true); // 2x speed
  assert.equal(isPlayback(30, 1, 1), false); // skipped ahead
  assert.equal(isPlayback(-10, 1, 1), false); // went back
});

test('isDone needs 90% of a known length', () => {
  assert.equal(isDone(90, 100), true);
  assert.equal(isDone(89, 100), false);
  assert.equal(isDone(500, 0), false);
});

test('timeLeft estimates days at the recent pace', async () => {
  const { timeLeft } = await import('../src/lib/format.ts');
  assert.equal(timeLeft(30, 600), '');
  assert.equal(timeLeft(7200, 0), '2h 00m left');
  assert.equal(timeLeft(7200, 1800), '2h 00m left · about 4 days at your pace');
});
