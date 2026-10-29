// Watch-time maths shared by the server (the source of truth) and the player (for the live strip).
export type Segment = [number, number];

// A video counts as done once this share of its unique seconds has been played.
export const DONE_RATIO = 0.9;

export function mergeSegments(segments: Segment[]): Segment[] {
  const sorted = segments
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .map(([a, b]) => [a, b] as Segment)
    .sort((x, y) => x[0] - y[0]);
  const out: Segment[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    // Ranges closer than a second apart are joined, so 1s polling leaves no gaps.
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10]);
}

export function coveredSeconds(segments: Segment[], duration: number): number {
  let total = 0;
  for (const [a, b] of segments) {
    total += Math.max(0, Math.min(b, duration || b) - Math.max(0, a));
  }
  return Math.round(total);
}

// A forward step no bigger than real time × speed (plus slack for timer jitter) is playback; anything else is a seek.
export function isPlayback(dt: number, elapsedS: number, rate: number): boolean {
  return dt > 0 && dt <= elapsedS * rate + 1.5;
}

export const isDone = (watchedS: number, durationS: number) => durationS > 0 && watchedS >= durationS * DONE_RATIO;
