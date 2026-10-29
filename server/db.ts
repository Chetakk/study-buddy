import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const dbPath =
  process.env.STUDY_BUDDY_DB ?? path.join(os.homedir(), '.local/share/study-buddy/study.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,              -- 'youtube_playlist' or 'problem_set' (one pattern from a problem sheet)
    external_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (kind, external_id)
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,              -- 'video' or 'problem'
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    duration_s INTEGER NOT NULL DEFAULT 0,
    thumbnail TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    UNIQUE (source_id, external_id)
  );

  -- segments: merged [start, end] second ranges actually played, as JSON.
  CREATE TABLE IF NOT EXISTS progress (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    segments TEXT NOT NULL DEFAULT '[]',
    watched_s INTEGER NOT NULL DEFAULT 0,
    position_s REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'not_started',   -- not_started | in_progress | done
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    at_s REAL NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Seconds of real study time per local day, for streaks and the heatmap.
  CREATE TABLE IF NOT EXISTS activity (
    day TEXT NOT NULL,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, item_id)
  );
`);

// Added for problem sets: the problem's own link, and JSON details (difficulty, concept, extra links).
const itemCols = (db.prepare('PRAGMA table_info(items)').all() as any[]).map((c) => c.name);
if (!itemCols.includes('url')) db.exec("ALTER TABLE items ADD COLUMN url TEXT NOT NULL DEFAULT ''");
if (!itemCols.includes('meta')) db.exec("ALTER TABLE items ADD COLUMN meta TEXT NOT NULL DEFAULT '{}'");

// Groups chosen for the Today page. Existing groups start on it, so nothing disappears.
const groupCols = (db.prepare('PRAGMA table_info(groups)').all() as any[]).map((c) => c.name);
if (!groupCols.includes('on_today')) db.exec('ALTER TABLE groups ADD COLUMN on_today INTEGER NOT NULL DEFAULT 1');

// Every table, parents before children; used by export and import.
export const TABLES = ['groups', 'sources', 'items', 'progress', 'notes', 'activity'];

// A video counts as done once this share of its unique seconds has been played.
export const DONE_RATIO = 0.9;

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type Segment = [number, number];

export function mergeSegments(segments: Segment[]): Segment[] {
  const sorted = segments
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
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
