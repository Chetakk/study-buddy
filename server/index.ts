import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  db,
  tx,
  localDay,
  mergeSegments,
  coveredSeconds,
  isDone,
  type Segment,
} from './db.ts';
import { fetchPlaylist, parsePlaylistId, type PlaylistVideo } from './youtube.ts';
import { fetchSheet, parseProblems, parseSheetUrl } from './sheets.ts';
import { fetchArticle, normalizeUrl } from './articles.ts';
import { cardPrompt, parseDrafts, provider, tidyTranscript } from './ai.ts';
import { HttpError } from './http.ts';
import { addProblemCard, createCard, getCard, listCards, queue, reviewCard, summary as cardSummary, updateCard } from './cards.ts';
import { backupNow, exportAll, importAll, scheduleBackups } from './backup.ts';
import { listen as remoteListen, openPages, send as remoteSend } from './remote.ts';

const PORT = Number(process.env.PORT ?? 7314);
const EXTENSION_ORIGIN = 'chrome-extension://akpgchnbfjjddggapkcmlbjpdfpconii';
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');


// ---------- queries ----------

// Done items count in full; others count the unique seconds actually played. Skipped items don't count.
const SOURCE_STATS = `
  SELECT s.id, s.group_id AS groupId, s.kind, s.title, s.channel, s.url, s.position,
         COUNT(i.id) AS total,
         COALESCE(SUM(p.status = 'done'), 0) AS done,
         COALESCE(SUM(i.duration_s), 0) AS durationS,
         COALESCE(SUM(CASE WHEN p.status = 'done' THEN i.duration_s
                           ELSE MIN(COALESCE(p.watched_s, 0), i.duration_s) END), 0) AS watchedS
  FROM sources s
  LEFT JOIN items i ON i.source_id = s.id AND i.skipped = 0
  LEFT JOIN progress p ON p.item_id = i.id
  GROUP BY s.id
  ORDER BY s.position, s.id`;

function listGroups() {
  const groups = (
    db.prepare('SELECT id, name, color, position, on_today AS onToday, goal_min AS goalMin FROM groups ORDER BY position, id').all() as any[]
  ).map((g) => ({ ...g, onToday: Boolean(g.onToday) }));
  const sources = db.prepare(SOURCE_STATS).all() as any[];
  return groups.map((g) => {
    const own = sources.filter((s) => s.groupId === g.id);
    const sum = (k: string) => own.reduce((a, s) => a + s[k], 0);
    return {
      ...g,
      total: sum('total'),
      done: sum('done'),
      durationS: sum('durationS'),
      watchedS: sum('watchedS'),
      sources: own,
    };
  });
}

// Items to work on next in a source: started ones first, then the earliest untouched.
function upNext(sourceIds: number[], limit: number) {
  if (!sourceIds.length) return [];
  const marks = sourceIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT i.id, i.title, i.duration_s AS durationS, i.thumbnail, i.source_id AS sourceId,
              s.title AS sourceTitle, COALESCE(p.watched_s, 0) AS watchedS,
              COALESCE(p.position_s, 0) AS positionS, COALESCE(p.status, 'not_started') AS status,
              i.kind, i.url, i.meta
       FROM items i JOIN sources s ON s.id = i.source_id
       LEFT JOIN progress p ON p.item_id = i.id
       WHERE i.source_id IN (${marks}) AND i.skipped = 0 AND COALESCE(p.status, 'not_started') != 'done'
       ORDER BY (COALESCE(p.status, 'not_started') = 'in_progress') DESC, p.updated_at DESC,
                s.position, i.position
       LIMIT ?`,
    )
    .all(...sourceIds, limit)
    .map(withMeta);
}

const withMeta = (r: any) => ({ ...r, meta: JSON.parse(r.meta || '{}') });

// Days with at least a minute of study or a solved problem, oldest first.
function studyDays(): string[] {
  const days = new Set(
    (db.prepare('SELECT day FROM activity GROUP BY day HAVING SUM(seconds) >= 60').all() as any[]).map((r) => r.day as string),
  );
  const solved = db
    .prepare(
      `SELECT p.completed_at AS at FROM progress p JOIN items i ON i.id = p.item_id
       WHERE i.kind = 'problem' AND p.status = 'done' AND p.completed_at IS NOT NULL`,
    )
    .all() as any[];
  for (const r of solved) days.add(localDay(new Date(r.at)));
  for (const r of db.prepare('SELECT DISTINCT day FROM reviews').all() as any[]) days.add(r.day);
  return [...days].sort();
}

function studiedTodayByGroup(): Set<number> {
  const rows = db
    .prepare(
      `SELECT DISTINCT s.group_id AS id FROM activity a JOIN items i ON i.id = a.item_id JOIN sources s ON s.id = i.source_id
       WHERE a.day = ? AND a.seconds >= 60`,
    )
    .all(localDay()) as any[];
  const ids = new Set(rows.map((r) => r.id as number));
  const solved = db
    .prepare(
      `SELECT s.group_id AS id, p.completed_at AS at FROM progress p JOIN items i ON i.id = p.item_id
       JOIN sources s ON s.id = i.source_id WHERE i.kind = 'problem' AND p.status = 'done' AND p.completed_at >= ?`,
    )
    .all(new Date(Date.now() - 864e5).toISOString()) as any[];
  for (const r of solved) if (localDay(new Date(r.at)) === localDay()) ids.add(r.id);
  return ids;
}

function streak(days = new Set(studyDays())): number {
  const d = new Date();
  // Today not studied yet doesn't break the streak; it just doesn't count.
  if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDay(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function longestStreak(days: string[]): number {
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const day of days) {
    const d = new Date(`${day}T12:00:00`);
    run = prev && Math.round((d.getTime() - prev.getTime()) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

// The video to pick up: the most recently played unfinished one, else the first untouched one.
function resume(groupIds: number[]) {
  const only = groupIds.length ? `AND g.id IN (${groupIds.map(Number).join(',')})` : '';
  const r = db
    .prepare(
      `SELECT i.id, i.title, i.duration_s AS durationS, i.thumbnail, i.position, i.source_id AS sourceId,
              s.title AS sourceTitle, g.id AS groupId, g.name AS groupName, g.color AS groupColor,
              COALESCE(p.segments, '[]') AS segments, COALESCE(p.watched_s, 0) AS watchedS,
              COALESCE(p.position_s, 0) AS positionS, COALESCE(p.status, 'not_started') AS status,
              (SELECT COUNT(*) FROM items WHERE source_id = i.source_id AND skipped = 0) AS sourceTotal
       FROM items i JOIN sources s ON s.id = i.source_id JOIN groups g ON g.id = s.group_id
       LEFT JOIN progress p ON p.item_id = i.id
       WHERE i.kind = 'video' AND i.skipped = 0 AND COALESCE(p.status, 'not_started') != 'done' ${only}
       ORDER BY (p.status = 'in_progress') DESC, p.updated_at DESC, g.position, s.position, i.position
       LIMIT 1`,
    )
    .get() as any;
  if (!r) return null;
  const next = db
    .prepare(
      `SELECT i.id, i.title, i.duration_s AS durationS, i.thumbnail
       FROM items i LEFT JOIN progress p ON p.item_id = i.id
       WHERE i.source_id = ? AND i.position > ? AND i.skipped = 0 AND COALESCE(p.status, 'not_started') != 'done'
       ORDER BY i.position LIMIT 1`,
    )
    .get(r.sourceId, r.position);
  return { ...r, segments: JSON.parse(r.segments) as Segment[], next: next ?? null };
}

function itemDetail(id: number) {
  const item = db
    .prepare(
      `SELECT i.id, i.kind, i.external_id AS externalId, i.title, i.duration_s AS durationS,
              i.thumbnail, i.position, i.source_id AS sourceId, s.title AS sourceTitle,
              g.id AS groupId, g.name AS groupName, g.color AS groupColor
       FROM items i JOIN sources s ON s.id = i.source_id JOIN groups g ON g.id = s.group_id
       WHERE i.id = ?`,
    )
    .get(id) as any;
  if (!item) throw new HttpError(404, 'Item not found');
  return {
    ...item,
    progress: progressFor(id),
    notes: db
      .prepare('SELECT id, at_s AS atS, body, created_at AS createdAt FROM notes WHERE item_id = ? ORDER BY at_s')
      .all(id),
    playlist: sourceItems(item.sourceId),
  };
}

function progressFor(itemId: number) {
  const p = db.prepare('SELECT * FROM progress WHERE item_id = ?').get(itemId) as any;
  return {
    segments: p ? (JSON.parse(p.segments) as Segment[]) : [],
    watchedS: p?.watched_s ?? 0,
    positionS: p?.position_s ?? 0,
    status: p?.status ?? 'not_started',
    completedAt: p?.completed_at ?? null,
    rewatchedAt: p?.rewatched_at ?? null,
  };
}

function sourceItems(sourceId: number) {
  return db
    .prepare(
      `SELECT i.id, i.kind, i.title, i.url, i.meta, i.duration_s AS durationS, i.thumbnail, i.position, i.skipped,
              COALESCE(p.watched_s, 0) AS watchedS, COALESCE(p.status, 'not_started') AS status,
              p.rewatched_at AS rewatchedAt
       FROM items i LEFT JOIN progress p ON p.item_id = i.id
       WHERE i.source_id = ? ORDER BY i.position`,
    )
    .all(sourceId)
    .map((r: any) => ({ ...withMeta(r), skipped: Boolean(r.skipped) }));
}

// Seconds a day spent on a group over the last two weeks, counting days off, or 0 if it wasn't studied.
const PACE_DAYS = 14;
function paceS(groupId: number): number {
  const since = new Date();
  since.setDate(since.getDate() - (PACE_DAYS - 1));
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(a.seconds), 0) AS s FROM activity a JOIN items i ON i.id = a.item_id
       JOIN sources s ON s.id = i.source_id WHERE s.group_id = ? AND a.day >= ?`,
    )
    .get(groupId, localDay(since)) as any;
  return Math.round(r.s / PACE_DAYS);
}

function nextPosition(table: 'groups' | 'sources'): number {
  return ((db.prepare(`SELECT MAX(position) AS m FROM ${table}`).get() as any).m ?? -1) + 1;
}

function upsertItems(sourceId: number, videos: Awaited<ReturnType<typeof fetchPlaylist>>['videos']) {
  const stmt = db.prepare(
    `INSERT INTO items (source_id, kind, external_id, title, duration_s, thumbnail, position)
     VALUES (?, 'video', ?, ?, ?, ?, ?)
     ON CONFLICT (source_id, external_id) DO UPDATE SET
       title = excluded.title, duration_s = excluded.duration_s,
       thumbnail = excluded.thumbnail, position = excluded.position`,
  );
  videos.forEach((v, i) => stmt.run(sourceId, v.videoId, v.title, v.durationS, v.thumbnail, i));
}

// ---------- routes ----------

type Handler = (params: string[], body: any, url: URL) => unknown | Promise<unknown>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, handler: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '(\\d+)')}$`), handler]);

route('GET', '/api/today', () => {
  const finished = new Map(
    (
      db
        .prepare(
          `SELECT s.group_id AS groupId, MAX(p.completed_at) AS at
           FROM progress p JOIN items i ON i.id = p.item_id JOIN sources s ON s.id = i.source_id
           GROUP BY s.group_id`,
        )
        .all() as any[]
    ).map((r) => [r.groupId, r.at]),
  );
  const touched = studiedTodayByGroup();
  const todayS = new Map(
    (
      db
        .prepare(
          `SELECT s.group_id AS id, SUM(a.seconds) AS s FROM activity a JOIN items i ON i.id = a.item_id
           JOIN sources s ON s.id = i.source_id WHERE a.day = ? GROUP BY s.group_id`,
        )
        .all(localDay()) as any[]
    ).map((r) => [r.id, r.s as number]),
  );
  const all = listGroups();
  // What to do first: your order, but groups already studied today move down and finished ones go last.
  const rank = (g: any) => (g.total > 0 && g.done === g.total ? 2 : touched.has(g.id) ? 1 : 0);
  const groups = all
    .filter((g) => g.onToday)
    .map((g) => ({
      ...g,
      upNext: upNext(
        g.sources.map((s: any) => s.id),
        1,
      ),
      studiedToday: touched.has(g.id),
      todayS: todayS.get(g.id) ?? 0,
      finishedAt: g.total > 0 && g.done === g.total ? (finished.get(g.id) ?? null) : null,
    }))
    .sort((a, b) => rank(a) - rank(b) || a.position - b.position);
  const today = db.prepare('SELECT COALESCE(SUM(seconds), 0) AS s FROM activity WHERE day = ?').get(localDay()) as any;
  // Average over the days actually studied in the 30 days before today.
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const avg = db
    .prepare(
      `SELECT AVG(s) AS s FROM (SELECT SUM(seconds) AS s FROM activity
       WHERE day >= ? AND day < ? GROUP BY day HAVING s >= 60)`,
    )
    .get(localDay(since), localDay()) as any;
  const days = studyDays();
  return {
    groups,
    allGroups: all.map(({ id, name, color, onToday }) => ({ id, name, color, onToday })),
    resume: resume(groups.map((g) => g.id)),
    studiedTodayS: today.s,
    avgDailyS: Math.round(avg.s ?? 0),
    streak: streak(new Set(days)),
    longestStreak: longestStreak(days),
  };
});

// Rule-based nudges, most useful first. Today shows only the top one.
function suggestions() {
  const out: { id: string; text: string; href: string; action: string }[] = [];
  const hour = new Date().getHours();
  const groups = listGroups().filter((g) => g.onToday && g.total > 0 && g.done < g.total);

  const days = studyDays();
  const today = localDay();
  const run = streak(new Set(days));
  if (run >= 2 && !days.includes(today) && hour >= 17) {
    out.push({ id: 'streak', text: `Keep your ${run}-day streak going: even ten minutes counts.`, href: '#/', action: '' });
  }

  // Videos that are nearly finished.
  const nearly = db
    .prepare(
      `SELECT i.id, i.title, i.duration_s AS d, p.watched_s AS w FROM progress p JOIN items i ON i.id = p.item_id
       WHERE i.kind = 'video' AND i.skipped = 0 AND p.status = 'in_progress' AND i.duration_s > 0 AND p.watched_s >= i.duration_s * 0.6
       ORDER BY p.updated_at DESC LIMIT 2`,
    )
    .all() as any[];
  // Two, because Today hides the one its resume card already shows.
  for (const v of nearly) {
    const left = Math.max(1, Math.round((v.d - v.w) / 60));
    out.push({ id: `finish-${v.id}`, text: `Finish "${v.title}": about ${left} min left.`, href: `#/watch/${v.id}`, action: 'Resume' });
  }

  // A daily goal not met yet, in the evening.
  if (hour >= 18) {
    for (const g of groups.filter((x) => x.goalMin > 0)) {
      const s = (
        db
          .prepare(
            `SELECT COALESCE(SUM(a.seconds), 0) AS s FROM activity a JOIN items i ON i.id = a.item_id
             JOIN sources s ON s.id = i.source_id WHERE s.group_id = ? AND a.day = ?`,
          )
          .get(g.id, today) as any
      ).s;
      const left = g.goalMin - Math.floor(s / 60);
      if (left > 0) out.push({ id: `goal-${g.id}`, text: `${left} min to go for your ${g.name} goal today.`, href: `#/group/${g.id}`, action: 'Open' });
    }
  }

  // A pile of due cards.
  const due = cardSummary().due;
  if (due >= 10) out.push({ id: 'cards', text: `${due} flashcards are waiting. A short review keeps them from piling up.`, href: '#/review', action: 'Review' });

  // The next pattern, once the one before it is finished.
  const patterns = db
    .prepare(
      `SELECT s.id, s.title, s.group_id AS groupId, COUNT(i.id) AS total, COALESCE(SUM(p.status = 'done'), 0) AS done
       FROM sources s JOIN items i ON i.source_id = s.id AND i.skipped = 0 LEFT JOIN progress p ON p.item_id = i.id
       WHERE s.kind = 'problem_set' GROUP BY s.id ORDER BY s.group_id, s.position, s.id`,
    )
    .all() as any[];
  for (let i = 1; i < patterns.length; i++) {
    const [prev, cur] = [patterns[i - 1], patterns[i]];
    if (prev.groupId === cur.groupId && prev.done === prev.total && cur.done === 0) {
      out.push({ id: `pattern-${cur.id}`, text: `You finished ${prev.title}. Next pattern: ${cur.title}.`, href: `#/source/${cur.id}`, action: 'Start' });
      break;
    }
  }

  // A group on Today that hasn't been touched for a while.
  const lastDay = db.prepare(
    `SELECT MAX(a.day) AS d FROM activity a JOIN items i ON i.id = a.item_id JOIN sources s ON s.id = i.source_id WHERE s.group_id = ?`,
  );
  for (const g of groups) {
    const d = (lastDay.get(g.id) as any).d as string | null;
    if (!d) continue;
    const gap = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${d}T12:00:00`)) / 864e5);
    if (gap >= 4) {
      out.push({ id: `stale-${g.id}-${d}`, text: `You haven't studied ${g.name} for ${gap} days.`, href: `#/group/${g.id}`, action: 'Open' });
      break;
    }
  }
  return out;
}

route('GET', '/api/suggestions', () => suggestions());

route('GET', '/api/sidebar', () => ({
  groups: listGroups().map(({ id, name, color, done, total }) => ({ id, name, color, done, total })),
  streak: streak(),
}));

// Jump-to search across groups, playlists and videos. An empty query lists groups and playlists.
route('GET', '/api/search', (_, __, url) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const groups = db
    .prepare(`SELECT id, name AS title, color FROM groups WHERE name LIKE ? ESCAPE '\\' ORDER BY position LIMIT 5`)
    .all(like) as any[];
  const sources = db
    .prepare(
      `SELECT s.id, s.kind, s.title, s.channel AS sub, g.color FROM sources s JOIN groups g ON g.id = s.group_id
       WHERE s.title LIKE ? ESCAPE '\\' ORDER BY g.position, s.position LIMIT 6`,
    )
    .all(like) as any[];
  const items = q
    ? (db
        .prepare(
          `SELECT i.id, i.kind, i.source_id AS sourceId, i.title, s.title AS sub, g.color FROM items i
           JOIN sources s ON s.id = i.source_id JOIN groups g ON g.id = s.group_id
           LEFT JOIN progress p ON p.item_id = i.id
           WHERE i.title LIKE ? ESCAPE '\\'
           ORDER BY (p.status = 'in_progress') DESC, (p.status = 'done'), g.position, s.position, i.position
           LIMIT 12`,
        )
        .all(like) as any[])
    : [];
  const notes = q
    ? (db
        .prepare(
          `SELECT n.at_s AS atS, n.body, i.id AS itemId, i.title AS sub, g.color FROM notes n
           JOIN items i ON i.id = n.item_id JOIN sources s ON s.id = i.source_id JOIN groups g ON g.id = s.group_id
           WHERE n.body LIKE ? ESCAPE '\\' ORDER BY n.created_at DESC LIMIT 5`,
        )
        .all(like) as any[])
    : [];
  return [
    ...groups.map((r) => ({ kind: 'Group', title: r.title, sub: '', color: r.color, href: `#/group/${r.id}` })),
    ...sources.map((r) => ({ kind: r.kind === 'problem_set' ? 'Pattern' : r.kind === 'articles' ? 'Reading list' : 'Playlist', title: r.title, sub: r.sub, color: r.color, href: `#/source/${r.id}` })),
    ...items.map((r) =>
      r.kind === 'problem' || r.kind === 'article'
        ? { kind: r.kind === 'problem' ? 'Problem' : 'Article', title: r.title, sub: r.sub, color: r.color, href: `#/source/${r.sourceId}` }
        : { kind: 'Video', title: r.title, sub: r.sub, color: r.color, href: `#/watch/${r.id}` },
    ),
    ...notes.map((r) => ({ kind: 'Note', title: r.body.split('\n')[0].slice(0, 120), sub: r.sub, color: r.color, href: `#/watch/${r.itemId}?t=${Math.floor(r.atS)}` })),
  ];
});

route('GET', '/api/groups', () => listGroups());

route('POST', '/api/groups', (_, b) => {
  const name = String(b.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Name is required');
  const r = db
    .prepare('INSERT INTO groups (name, color, position) VALUES (?, ?, ?)')
    .run(name, String(b.color ?? 'sky'), nextPosition('groups'));
  return { id: Number(r.lastInsertRowid) };
});

route('PATCH', '/api/groups/:id', ([id], b) => {
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) throw new HttpError(400, 'Name is required');
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, Number(id));
  }
  if (b.color !== undefined) db.prepare('UPDATE groups SET color = ? WHERE id = ?').run(String(b.color), Number(id));
  if (b.onToday !== undefined) db.prepare('UPDATE groups SET on_today = ? WHERE id = ?').run(b.onToday ? 1 : 0, Number(id));
  if (b.goalMin !== undefined) {
    db.prepare('UPDATE groups SET goal_min = ? WHERE id = ?').run(Math.max(0, Math.min(600, Math.round(Number(b.goalMin) || 0))), Number(id));
  }
  return { ok: true };
});

route('DELETE', '/api/groups/:id', ([id]) => {
  db.prepare('DELETE FROM groups WHERE id = ?').run(Number(id));
  return { ok: true };
});

// The Today page reorders only the groups it shows; hidden groups keep their places between them.
route('POST', '/api/groups/order', (_, b) => {
  const given = (b.ids as number[]).map(Number);
  const all = (db.prepare('SELECT id FROM groups ORDER BY position, id').all() as any[]).map((r) => r.id as number);
  const queue = given.filter((id) => all.includes(id));
  const order = all.map((id) => (queue.length && given.includes(id) ? queue.shift()! : id));
  const stmt = db.prepare('UPDATE groups SET position = ? WHERE id = ?');
  tx(() => order.forEach((id, i) => stmt.run(i, id)));
  return { ok: true };
});

// One group: its playlists and problem patterns with progress, what to do next, and every problem.
route('GET', '/api/groups/:id', ([id]) => {
  const g = listGroups().find((x) => x.id === Number(id));
  if (!g) throw new HttpError(404, 'Group not found');
  const last = db.prepare(
    `SELECT MAX(p.updated_at) AS at FROM progress p JOIN items i ON i.id = p.item_id WHERE i.source_id = ?`,
  );
  const sources = g.sources.map((s: any) => ({
    ...s,
    next: upNext([s.id], 1)[0] ?? null,
    lastAt: (last.get(s.id) as any).at ?? null,
    items: s.kind === 'problem_set' || s.kind === 'articles' ? sourceItems(s.id) : undefined,
  }));
  const videoIds = sources.filter((s: any) => s.kind === 'youtube_playlist').map((s: any) => s.id);
  return { ...g, sources, upNext: upNext(videoIds, 5), paceS: paceS(g.id) };
});

function checkNewSource(groupId: number, playlistId: string) {
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId)) throw new HttpError(400, 'Pick a group first');
  const existing = db
    .prepare(
      `SELECT g.name FROM sources s JOIN groups g ON g.id = s.group_id
       WHERE s.kind = 'youtube_playlist' AND s.external_id = ?`,
    )
    .get(playlistId) as any;
  if (existing) throw new HttpError(409, `This playlist is already in "${existing.name}"`);
}

function insertSource(groupId: number, playlistId: string, pl: { title: string; channel: string; videos: PlaylistVideo[] }) {
  return tx(() => {
    const r = db
      .prepare(
        `INSERT INTO sources (group_id, kind, external_id, url, title, channel, position)
         VALUES (?, 'youtube_playlist', ?, ?, ?, ?, ?)`,
      )
      .run(
        groupId,
        playlistId,
        `https://www.youtube.com/playlist?list=${playlistId}`,
        pl.title,
        pl.channel,
        nextPosition('sources'),
      );
    const id = Number(r.lastInsertRowid);
    upsertItems(id, pl.videos);
    return { id, title: pl.title, count: pl.videos.length };
  });
}

route('POST', '/api/sources', async (_, b) => {
  const groupId = Number(b.groupId);
  const playlistId = parsePlaylistId(String(b.url ?? ''));
  if (!playlistId) throw new HttpError(400, "That doesn't look like a YouTube playlist link (it needs ?list=…)");
  checkNewSource(groupId, playlistId);
  const pl = await fetchPlaylist(playlistId);
  if (!pl.videos.length) throw new HttpError(422, 'The playlist has no public videos');
  return insertSource(groupId, playlistId, pl);
});

// The extension reads a playlist from the page in the user's logged-in browser, so private playlists work too.
route('POST', '/api/sources/from-page', (_, b) => {
  const groupId = Number(b.groupId);
  const playlistId = String(b.playlistId ?? '');
  if (!/^[\w-]{2,64}$/.test(playlistId)) throw new HttpError(400, 'Missing playlist id');
  checkNewSource(groupId, playlistId);
  const videos: PlaylistVideo[] = [];
  const seen = new Set<string>();
  for (const v of Array.isArray(b.videos) ? b.videos : []) {
    const videoId = String(v?.videoId ?? '');
    if (!/^[\w-]{11}$/.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    videos.push({
      videoId,
      title: String(v.title ?? '').slice(0, 300) || 'Untitled',
      durationS: Math.max(0, Math.round(Number(v.durationS) || 0)),
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    });
  }
  if (!videos.length) throw new HttpError(422, 'No videos found on the page');
  return insertSource(groupId, playlistId, {
    title: String(b.title ?? '').slice(0, 300) || 'Untitled playlist',
    channel: String(b.channel ?? '').slice(0, 200),
    videos,
  });
});

route('GET', '/api/sources/:id', ([id]) => {
  const source = (db.prepare(SOURCE_STATS.replace('GROUP BY', 'WHERE s.id = ? GROUP BY')).get(Number(id)) as any) ?? null;
  if (!source) throw new HttpError(404, 'Source not found');
  const group = db.prepare('SELECT id, name, color FROM groups WHERE id = ?').get(source.groupId);
  return { ...source, group, items: sourceItems(Number(id)), paceS: paceS(source.groupId) };
});

route('PATCH', '/api/sources/:id', ([id], b) => {
  if (b.groupId !== undefined) db.prepare('UPDATE sources SET group_id = ? WHERE id = ?').run(Number(b.groupId), Number(id));
  return { ok: true };
});

// Imports a problem sheet as one source per pattern. Running it again picks up new problems and keeps progress;
// patterns already imported stay in whatever group they were moved to.
async function importSheet(groupId: number, url: string) {
  const ref = parseSheetUrl(url);
  if (!ref) throw new HttpError(400, "That doesn't look like a Google Sheets link");
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId)) throw new HttpError(400, 'Pick a group first');
  let sections;
  try {
    sections = parseProblems(await fetchSheet(ref.id, ref.gid));
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
  if (!sections.length) throw new HttpError(422, 'No problems found. Each pattern needs a heading row, then one problem per row.');
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${ref.id}/edit#gid=${ref.gid}`;
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM items WHERE kind = 'problem'").get() as any).n;
  const before = count();
  tx(() => {
    const item = db.prepare(
      `INSERT INTO items (source_id, kind, external_id, title, url, meta, position)
       VALUES (?, 'problem', ?, ?, ?, ?, ?)
       ON CONFLICT (source_id, external_id) DO UPDATE SET
         title = excluded.title, url = excluded.url, meta = excluded.meta, position = excluded.position`,
    );
    for (const sec of sections) {
      const external = `sheet:${ref.id}:${ref.gid}:${sec.slug}`;
      let src = db.prepare("SELECT id FROM sources WHERE kind = 'problem_set' AND external_id = ?").get(external) as any;
      if (src) {
        db.prepare("UPDATE sources SET title = ?, url = ?, synced_at = datetime('now') WHERE id = ?").run(sec.title, sheetUrl, src.id);
      } else {
        const r = db
          .prepare(
            `INSERT INTO sources (group_id, kind, external_id, url, title, channel, position)
             VALUES (?, 'problem_set', ?, ?, ?, 'Problem sheet', ?)`,
          )
          .run(groupId, external, sheetUrl, sec.title, nextPosition('sources'));
        src = { id: Number(r.lastInsertRowid) };
      }
      sec.problems.forEach((p, i) =>
        item.run(
          src.id,
          p.key,
          p.title,
          p.url,
          JSON.stringify({ difficulty: p.difficulty, concept: p.concept, challenge: p.challenge, homework: p.homework, links: p.links }),
          i,
        ),
      );
    }
  });
  const total = sections.reduce((a, s) => a + s.problems.length, 0);
  return { sections: sections.length, total, added: count() - before };
}

// Articles go into the group's reading list (one 'articles' source per group, made on first use).
route('POST', '/api/articles', async (_, b) => {
  const groupId = Number(b.groupId);
  if (!db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId)) throw new HttpError(400, 'Pick a group first');
  const url = normalizeUrl(String(b.url ?? ''));
  if (!url) throw new HttpError(400, "That doesn't look like a link");
  const dupe = db.prepare("SELECT g.name FROM items i JOIN sources s ON s.id = i.source_id JOIN groups g ON g.id = s.group_id WHERE i.kind = 'article' AND i.external_id = ?").get(url) as any;
  if (dupe) throw new HttpError(409, `This article is already in "${dupe.name}"`);
  let a;
  try {
    a = await fetchArticle(url);
  } catch (e) {
    throw new HttpError(422, (e as Error).message);
  }
  return tx(() => {
    let src = db.prepare("SELECT id FROM sources WHERE kind = 'articles' AND group_id = ?").get(groupId) as any;
    if (!src) {
      const r = db
        .prepare(`INSERT INTO sources (group_id, kind, external_id, url, title, position) VALUES (?, 'articles', ?, '', 'Reading list', ?)`)
        .run(groupId, `articles:${groupId}:${Date.now()}`, nextPosition('sources'));
      src = { id: Number(r.lastInsertRowid) };
    }
    const pos = ((db.prepare('SELECT MAX(position) AS m FROM items WHERE source_id = ?').get(src.id) as any).m ?? -1) + 1;
    const r = db
      .prepare(`INSERT INTO items (source_id, kind, external_id, title, url, duration_s, position, meta) VALUES (?, 'article', ?, ?, ?, ?, ?, ?)`)
      .run(src.id, url, a.title, url, a.readingS, pos, JSON.stringify({ words: a.words }));
    return { id: Number(r.lastInsertRowid), title: a.title, minutes: Math.round(a.readingS / 60) };
  });
});

route('POST', '/api/sheets', (_, b) => importSheet(Number(b.groupId), String(b.url ?? '')));

route('POST', '/api/sources/:id/sync', async ([id]) => {
  const s = db.prepare('SELECT external_id, kind, url, group_id FROM sources WHERE id = ?').get(Number(id)) as any;
  if (!s) throw new HttpError(404, 'Source not found');
  if (s.kind === 'problem_set') return importSheet(s.group_id, s.url);
  if (s.kind === 'articles') return { added: 0 };
  const pl = await fetchPlaylist(s.external_id);
  const before = (db.prepare('SELECT COUNT(*) AS n FROM items WHERE source_id = ?').get(Number(id)) as any).n;
  tx(() => {
    db.prepare("UPDATE sources SET title = ?, channel = ?, synced_at = datetime('now') WHERE id = ?").run(
      pl.title,
      pl.channel,
      Number(id),
    );
    upsertItems(Number(id), pl.videos);
  });
  const after = (db.prepare('SELECT COUNT(*) AS n FROM items WHERE source_id = ?').get(Number(id)) as any).n;
  return { added: after - before };
});

route('DELETE', '/api/sources/:id', ([id]) => {
  db.prepare('DELETE FROM sources WHERE id = ?').run(Number(id));
  return { ok: true };
});

route('GET', '/api/items/:id', ([id]) => itemDetail(Number(id)));

// Called by the player every few seconds with the ranges played since the last call.
route('POST', '/api/items/:id/progress', ([id], b) => recordProgress(Number(id), b));

// The extension reports playback on youtube.com by video id. Videos not in Study Buddy are ignored;
// a video in several playlists counts toward the one being played (list=…) if it's there.
route('POST', '/api/track', (_, b) => {
  const videoId = String(b.videoId ?? '');
  if (!/^[\w-]{11}$/.test(videoId)) throw new HttpError(400, 'Missing video id');
  const item = db
    .prepare(
      `SELECT i.id, i.title FROM items i JOIN sources s ON s.id = i.source_id
       WHERE i.kind = 'video' AND i.external_id = ? ORDER BY (s.external_id = ?) DESC, i.id LIMIT 1`,
    )
    .get(videoId, String(b.listId ?? '')) as any;
  if (!item) return { tracked: false };
  return { tracked: true, itemId: item.id, title: item.title, ...recordProgress(item.id, b) };
});

function recordProgress(itemId: number, b: any) {
  const item = db.prepare('SELECT duration_s FROM items WHERE id = ?').get(itemId) as any;
  if (!item) throw new HttpError(404, 'Item not found');
  const reported = Math.round(Number(b.durationS) || 0);
  if (!item.duration_s && reported > 0) {
    db.prepare('UPDATE items SET duration_s = ? WHERE id = ?').run(reported, itemId);
    item.duration_s = reported;
  }
  return tx(() => {
    const prev = progressFor(itemId);
    const segments = mergeSegments([...prev.segments, ...((b.segments ?? []) as Segment[])]);
    const watched = coveredSeconds(segments, item.duration_s);
    let status = prev.status;
    let completedAt = prev.completedAt;
    if (status !== 'done') {
      if (isDone(watched, item.duration_s)) {
        status = 'done';
        completedAt = new Date().toISOString();
      } else if (watched > 0) {
        status = 'in_progress';
      }
    }
    db.prepare(
      `INSERT INTO progress (item_id, segments, watched_s, position_s, status, completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (item_id) DO UPDATE SET
         segments = excluded.segments, watched_s = excluded.watched_s, position_s = excluded.position_s,
         status = excluded.status, completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
    ).run(itemId, JSON.stringify(segments), watched, Number(b.positionS) || 0, status, completedAt);

    // Wall-clock time spent playing; capped per call so a stuck tab can't inflate it.
    const played = Math.min(Math.max(Math.round(Number(b.playedS) || 0), 0), 120);
    // Playing a video that was finished more than an hour ago counts as a rewatch.
    if (played && prev.status === 'done' && prev.completedAt && Date.parse(prev.completedAt) < Date.now() - 3600e3) {
      db.prepare("UPDATE progress SET rewatched_at = datetime('now') WHERE item_id = ?").run(itemId);
    }
    if (played) {
      db.prepare(
        `INSERT INTO activity (day, item_id, seconds) VALUES (?, ?, ?)
         ON CONFLICT (day, item_id) DO UPDATE SET seconds = seconds + excluded.seconds`,
      ).run(localDay(), itemId, played);
    }
    return progressFor(itemId);
  });
}

route('POST', '/api/items/:id/status', ([id], b) => {
  const itemId = Number(id);
  const done = Boolean(b.done);
  const prev = progressFor(itemId);
  const status = done ? 'done' : prev.watchedS > 0 ? 'in_progress' : 'not_started';
  db.prepare(
    `INSERT INTO progress (item_id, status, completed_at) VALUES (?, ?, ?)
     ON CONFLICT (item_id) DO UPDATE SET status = excluded.status,
       completed_at = excluded.completed_at, updated_at = datetime('now')`,
  ).run(itemId, status, done ? new Date().toISOString() : null);
  if (done) addProblemCard(itemId);
  // Reading happens outside the app, so a finished article counts its estimated reading time, once.
  const article = db.prepare("SELECT duration_s AS d FROM items WHERE id = ? AND kind = 'article'").get(itemId) as any;
  if (done && article && !db.prepare('SELECT 1 FROM activity WHERE item_id = ?').get(itemId)) {
    db.prepare('INSERT INTO activity (day, item_id, seconds) VALUES (?, ?, ?)').run(localDay(), itemId, article.d);
  }
  return progressFor(itemId);
});

route('POST', '/api/items/:id/skip', ([id], b) => {
  db.prepare('UPDATE items SET skipped = ? WHERE id = ?').run(b.skipped ? 1 : 0, Number(id));
  return { ok: true };
});

route('POST', '/api/items/:id/notes', ([id], b) => {
  const body = String(b.body ?? '').trim();
  if (!body) throw new HttpError(400, 'Note is empty');
  const r = db.prepare('INSERT INTO notes (item_id, at_s, body) VALUES (?, ?, ?)').run(Number(id), Number(b.atS) || 0, body);
  return { id: Number(r.lastInsertRowid) };
});

// Every note, newest video activity first; q filters by note text or video title.
route('GET', '/api/notes', (_, __, url) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  return db
    .prepare(
      `SELECT n.id, n.at_s AS atS, n.body, n.created_at AS createdAt, i.id AS itemId, i.title AS itemTitle,
              i.thumbnail, s.title AS sourceTitle, g.name AS groupName, g.color AS groupColor
       FROM notes n JOIN items i ON i.id = n.item_id JOIN sources s ON s.id = i.source_id JOIN groups g ON g.id = s.group_id
       WHERE n.body LIKE ? ESCAPE '\\' OR i.title LIKE ? ESCAPE '\\'
       ORDER BY (SELECT MAX(created_at) FROM notes WHERE item_id = i.id) DESC, i.id, n.at_s
       LIMIT 500`,
    )
    .all(like, like);
});

route('DELETE', '/api/notes/:id', ([id]) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(Number(id));
  return { ok: true };
});

route('GET', '/api/stats', () => {
  const since = new Date();
  since.setDate(since.getDate() - 7 * 53);
  const days = db
    .prepare('SELECT day, SUM(seconds) AS seconds FROM activity WHERE day >= ? GROUP BY day ORDER BY day')
    .all(localDay(since));
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const week = db
    .prepare(
      `SELECT a.day, s.group_id AS groupId, SUM(a.seconds) AS seconds
       FROM activity a JOIN items i ON i.id = a.item_id JOIN sources s ON s.id = i.source_id
       WHERE a.day >= ? GROUP BY a.day, s.group_id`,
    )
    .all(localDay(weekStart));
  const totalS = (db.prepare('SELECT COALESCE(SUM(seconds), 0) AS s FROM activity').get() as any).s;
  return { groups: listGroups(), days, week, totalStudiedS: totalS, streak: streak() };
});

// ---------- flashcards ----------

route('GET', '/api/cards', (_, __, url) => listCards(url));
route('GET', '/api/cards/summary', () => cardSummary());
route('GET', '/api/cards/queue', (_, __, url) => queue(Number(url.searchParams.get('group')) || undefined));
route('POST', '/api/cards', (_, b) => createCard(b));
route('GET', '/api/cards/:id', ([id]) => getCard(Number(id)));
route('PATCH', '/api/cards/:id', ([id], b) => updateCard(Number(id), b));
route('DELETE', '/api/cards/:id', ([id]) => {
  db.prepare('DELETE FROM cards WHERE id = ?').run(Number(id));
  return { ok: true };
});
route('GET', '/api/ai', () => {
  const p = provider();
  return { provider: p.name, model: p.model, ready: p.ready };
});

// Drafts cards for a video from a pasted transcript and/or its notes. Drafts wait in "Pending review".
route('POST', '/api/items/:id/draft-cards', async ([id], b) => {
  const item = db.prepare("SELECT id, title FROM items WHERE id = ? AND kind = 'video'").get(Number(id)) as any;
  if (!item) throw new HttpError(404, 'Video not found');
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const notes = (db.prepare('SELECT at_s AS atS, body FROM notes WHERE item_id = ? ORDER BY at_s').all(item.id) as any[])
    .map((n) => `[${clock(n.atS)}] ${n.body}`)
    .join('\n');
  const transcript = tidyTranscript(String(b.transcript ?? ''));
  if (!transcript && !notes) throw new HttpError(400, 'Paste the transcript, or write some notes first');
  const text = [transcript && `Transcript:\n${transcript}`, notes && `Learner's notes:\n${notes}`].filter(Boolean).join('\n\n');
  const ai = provider();
  if (!ai.ready) throw new HttpError(400, 'No AI provider is set up');
  let drafts;
  try {
    drafts = parseDrafts(await ai.complete(cardPrompt(item.title, text)));
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
  for (const d of drafts) createCard({ ...d, itemId: item.id, origin: 'ai', pending: true });
  return { added: drafts.length };
});

route('POST', '/api/cards/:id/review', ([id], b) => reviewCard(Number(id), Number(b.rating)));

route('GET', '/api/export', () => exportAll());

route('POST', '/api/import', (_, b) => {
  try {
    return { counts: importAll(b) };
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});

route('POST', '/api/backup', () => ({ file: backupNow() }));

route('GET', '/api/remote/pages', () => openPages());
route('POST', '/api/remote', (_, b) => remoteSend(b));

// ---------- server ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function serveStatic(urlPath: string, res: http.ServerResponse) {
  let file = path.join(DIST, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html'); // client-side routes
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('Run "npm run build" first, or use "npm run dev".');
    return;
  }
  // Hashed build assets never change; the shell and service worker must always be revalidated.
  const cache = urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(file).pipe(res);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  };

  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

  // Only this app (served from localhost) and its own Chrome extension may call the API, not arbitrary websites.
  // The extension's ID is fixed by the "key" in extension/manifest.json.
  const origin = req.headers.origin;
  if (origin && origin !== EXTENSION_ORIGIN && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return send(403, { error: 'Forbidden origin' });
  }
  if (req.method === 'GET' && url.pathname === '/api/remote') return remoteListen(req, res, url);

  try {
    for (const [method, re, handler] of routes) {
      const m = url.pathname.match(re);
      if (m && method === req.method) {
        const body = method === 'GET' ? {} : await readBody(req);
        return send(200, await handler(m.slice(1), body, url));
      }
    }
    send(404, { error: 'Not found' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    send(status, { error: err instanceof Error ? err.message : String(err) });
  }
});

scheduleBackups();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Study Buddy API on http://127.0.0.1:${PORT}`);
});
