import fs from 'node:fs';
import path from 'node:path';
import { db, dbPath, localDay, tx, TABLES } from './db.ts';

const BACKUP_DIR = path.join(path.dirname(dbPath), 'backups');
const KEEP = 7;

// One snapshot per day, named by date; the oldest beyond KEEP are removed.
export function backupNow(tag = localDay()): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `study-${tag}.db`);
  fs.rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^study-\d{4}-\d{2}-\d{2}.*\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
  return file;
}

export function scheduleBackups() {
  const daily = () => {
    if (!fs.existsSync(path.join(BACKUP_DIR, `study-${localDay()}.db`))) backupNow();
  };
  try {
    daily();
  } catch (e) {
    console.error('Backup failed:', e);
  }
  setInterval(() => {
    try {
      daily();
    } catch (e) {
      console.error('Backup failed:', e);
    }
  }, 3600e3).unref();
}

export function exportAll() {
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = db.prepare(`SELECT * FROM ${t}`).all();
  return { app: 'study-buddy', version: 1, exportedAt: new Date().toISOString(), tables };
}

// Replaces everything with an export. Takes a snapshot first so a bad file can be undone.
export function importAll(data: any): Record<string, number> {
  if (data?.app !== 'study-buddy' || typeof data.tables !== 'object') throw new Error('Not a Study Buddy export');
  backupNow(`${localDay()}-before-import`);
  const counts: Record<string, number> = {};
  tx(() => {
    for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      const rows = Array.isArray(data.tables[t]) ? data.tables[t] : [];
      const cols = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name as string));
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => cols.has(k));
        if (!keys.length) continue;
        db.prepare(`INSERT INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
          ...keys.map((k) => row[k]),
        );
      }
      counts[t] = rows.length;
    }
  });
  return counts;
}
