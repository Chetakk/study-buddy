import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export { DONE_RATIO, mergeSegments, coveredSeconds, isDone, type Segment } from '../shared/segments.ts';

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
// Skipped items (intros, repeated uploads) stay listed but don't count toward progress or come up next.
if (!itemCols.includes('skipped')) db.exec('ALTER TABLE items ADD COLUMN skipped INTEGER NOT NULL DEFAULT 0');

// When a finished video was last played again (it stays done).
const progressCols = (db.prepare('PRAGMA table_info(progress)').all() as any[]).map((c) => c.name);
if (!progressCols.includes('rewatched_at')) db.exec('ALTER TABLE progress ADD COLUMN rewatched_at TEXT');

// Groups chosen for the Today page. Existing groups start on it, so nothing disappears.
const groupCols = (db.prepare('PRAGMA table_info(groups)').all() as any[]).map((c) => c.name);
if (!groupCols.includes('on_today')) db.exec('ALTER TABLE groups ADD COLUMN on_today INTEGER NOT NULL DEFAULT 1');

// Every table, parents before children; used by export and import.
export const TABLES = ['groups', 'sources', 'items', 'progress', 'notes', 'activity'];

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
