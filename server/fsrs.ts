// FSRS-4.5 spaced repetition (https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
// with the default weights. Stability is in days: the interval at which recall chance falls to 90%.

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export interface Memory {
  state: CardState;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReview: Date | null;
}

const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5;
const FACTOR = 19 / 81;
export const RETENTION = 0.9;
const MAX_DAYS = 365 * 3;
// A card you got wrong (or are still learning) comes back in the same session after this many minutes.
const RELEARN_MIN = [10, 5]; // Again, Hard

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const initDifficulty = (g: Rating) => clamp(W[4] - (g - 3) * W[5], 1, 10);

export const retrievability = (elapsedDays: number, stability: number) => (1 + (FACTOR * elapsedDays) / stability) ** DECAY;

export const intervalDays = (stability: number) =>
  clamp(Math.round((stability / FACTOR) * (RETENTION ** (1 / DECAY) - 1)), 1, MAX_DAYS);

export const newMemory = (): Memory => ({ state: 'new', stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null });

export function review(m: Memory, g: Rating, now = new Date()): { memory: Memory; due: Date } {
  let { stability: s, difficulty: d, lapses } = m;
  let state: CardState;

  if (m.state === 'new' || !m.lastReview) {
    s = W[g - 1];
    d = initDifficulty(g);
    state = g <= 2 ? 'learning' : 'review';
  } else {
    const elapsed = Math.max(0, (now.getTime() - m.lastReview.getTime()) / 864e5);
    const r = retrievability(elapsed, s);
    // Difficulty moves with the rating and drifts back toward the default.
    d = clamp(W[7] * initDifficulty(4) + (1 - W[7]) * (d - W[6] * (g - 3)), 1, 10);
    if (g === 1) {
      const forgot = W[11] * d ** -W[12] * ((s + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r));
      s = Math.min(s, forgot);
      if (m.state === 'review') lapses++;
      state = 'relearning';
    } else if (elapsed < 1 && m.state !== 'review') {
      // Same-day steps while learning: stability grows a little (like FSRS-5's short-term formula).
      s = s * Math.exp(W[8] * 0.15 * (g - 3 + 1));
      state = g === 2 ? m.state : 'review';
    } else {
      const hard = g === 2 ? W[15] : 1;
      const easy = g === 4 ? W[16] : 1;
      s = s * (Math.exp(W[8]) * (11 - d) * s ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
      state = 'review';
    }
  }

  s = clamp(s, 0.1, 36500);
  const due =
    state === 'review'
      ? new Date(now.getTime() + intervalDays(s) * 864e5)
      : new Date(now.getTime() + RELEARN_MIN[g === 1 ? 0 : 1] * 60e3);
  return { memory: { state, stability: s, difficulty: d, reps: m.reps + 1, lapses, lastReview: now }, due };
}

// What each button would do, for the labels under them ("10m", "3d", …).
export function preview(m: Memory, now = new Date()): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const g of [1, 2, 3, 4] as Rating[]) out[g] = review(m, g, now).due.getTime() - now.getTime();
  return out;
}
