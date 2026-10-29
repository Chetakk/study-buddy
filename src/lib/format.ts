// Categorical slots in validated order. New groups take the next unused slot.
export const GROUP_COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'] as const;

export const colorVar = (key: string) => `var(--g-${GROUP_COLORS.includes(key as any) ? key : 'blue'})`;

export function nextColor(used: string[]): string {
  return GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[used.length % GROUP_COLORS.length];
}

// What a group or source counts: "videos", "problems", or "items" when it mixes both.
const UNIT: Record<string, string> = { problem_set: 'problem', youtube_playlist: 'video', articles: 'article' };

// What to call a mix of sources' items: "videos", "problems", "articles", or "items" when mixed.
export function unitOf(kinds: string[], n = 2): string {
  const words = new Set(kinds.map((k) => UNIT[k] ?? 'item'));
  const word = words.size === 1 ? [...words][0] : 'item';
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

export { mergeSegments, coveredSeconds } from '../../shared/segments.ts';

// "6h 20m left · about 9 days at your pace", or just the time left when there's no recent pace.
export function timeLeft(leftS: number, paceS: number): string {
  if (leftS < 60) return '';
  const days = paceS >= 60 ? Math.ceil(leftS / paceS) : 0;
  const eta = !days ? '' : days === 1 ? ' · about a day at your pace' : days > 365 ? ' · over a year at your pace' : ` · about ${days} days at your pace`;
  return `${fmtDuration(leftS)} left${eta}`;
}

// "2026-10-29" in local time, matching the server's day keys.
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
