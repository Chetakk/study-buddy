import type { Segment } from '../types.ts';

// Categorical slots in validated order. New groups take the next unused slot.
export const GROUP_COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] as const;

export const colorVar = (key: string) => `var(--g-${GROUP_COLORS.includes(key as any) ? key : 'blue'})`;

export function nextColor(used: string[]): string {
  return GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[used.length % GROUP_COLORS.length];
}

// What a group or source counts: "videos", "problems", or "items" when it mixes both.
export function unitOf(kinds: string[], n = 2): string {
  const set = new Set(kinds);
  const word = set.size === 1 && set.has('problem_set') ? 'problem' : set.size && !set.has('problem_set') ? 'video' : 'item';
  return n === 1 ? word : `${word}s`;
}

// 3725 -> "1h 02m", 125 -> "2m", 30 -> "30s"
export function fmtDuration(s: number): string {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}

// 3725 -> "1:02:05", 125 -> "2:05"
export function fmtClock(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const ratio = (part: number, whole: number) => (whole > 0 ? Math.min(part / whole, 1) : 0);
export const pct = (part: number, whole: number) => `${Math.round(ratio(part, whole) * 100)}%`;

// Mirrors server/db.ts mergeSegments, so the strip updates live between saves.
export function mergeSegments(segments: Segment[]): Segment[] {
  const sorted = segments.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Segment[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export const coveredSeconds = (segments: Segment[], duration: number) =>
  segments.reduce((t, [a, b]) => t + Math.max(0, Math.min(b, duration || b) - Math.max(0, a)), 0);
