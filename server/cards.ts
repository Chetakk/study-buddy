import { db, localDay } from './db.ts';
import { HttpError } from './http.ts';
import { newMemory, preview, review, type Memory, type Rating } from './fsrs.ts';

// New cards introduced per day, so a big batch doesn't swamp every later day.
export const NEW_PER_DAY = 20;

export type Pile = 'pending' | 'new' | 'learning' | 'review' | 'mastered' | 'struggling';

export function pileOf(c: { pending: number; reps: number; state: string; stability: number; lapses: number; difficulty: number }): Pile {
  if (c.pending) return 'pending';
  if (c.reps === 0) return 'new';
  if (c.stability >= 21) return 'mastered';
  if (c.lapses >= 3 || c.difficulty >= 8) return 'struggling';
  if (c.state !== 'review' || c.stability < 7) return 'learning';
  return 'review';
}

const CARD_SELECT = `
  SELECT c.*, g.name AS group_name, g.color AS group_color,
         i.title AS item_title, i.kind AS item_kind, i.url AS item_url, i.meta AS item_meta, i.source_id AS source_id,
         s.title AS source_title
  FROM cards c
  LEFT JOIN groups g ON g.id = c.group_id
  LEFT JOIN items i ON i.id = c.item_id
  LEFT JOIN sources s ON s.id = i.source_id`;

const memoryOf = (r: any): Memory => ({
  state: r.state,
  stability: r.stability,
  difficulty: r.difficulty,
  reps: r.reps,
  lapses: r.lapses,
  lastReview: r.last_review ? new Date(r.last_review) : null,
});

function toCard(r: any) {
  const meta = JSON.parse(r.item_meta || '{}');
  return {
    id: r.id,
    groupId: r.group_id,
    groupName: r.group_name ?? '',
    groupColor: r.group_color ?? 'blue',
    itemId: r.item_id,
    itemTitle: r.item_title ?? null,
    itemKind: r.item_kind ?? null,
    itemUrl: r.item_url || null,
    sourceId: r.source_id ?? null,
    sourceTitle: r.source_title ?? null,
    atS: r.at_s,
    kind: r.kind,
    front: r.front,
    back: r.back,
    origin: r.origin,
    pile: pileOf(r),
    state: r.state,
    due: r.due,
    reps: r.reps,
    lapses: r.lapses,
    stabilityDays: Math.round(r.stability * 10) / 10,
    problem: r.kind === 'problem' ? { difficulty: meta.difficulty ?? '', concept: meta.concept ?? '', links: meta.links ?? [] } : null,
    createdAt: r.created_at,
  };
}

export function getCard(id: number) {
  const r = db.prepare(`${CARD_SELECT} WHERE c.id = ?`).get(id);
  if (!r) throw new HttpError(404, 'Card not found');
  return toCard(r);
}

function groupOfItem(itemId: number): number | null {
  const r = db.prepare('SELECT s.group_id AS g FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id = ?').get(itemId) as any;
  return r?.g ?? null;
}

export function createCard(b: any) {
  const front = String(b.front ?? '').trim();
  const back = String(b.back ?? '').trim();
  if (!front) throw new HttpError(400, 'The front of the card is empty');
  const itemId = b.itemId ? Number(b.itemId) : null;
  const groupId = (itemId && groupOfItem(itemId)) || (b.groupId ? Number(b.groupId) : null);
  if (!groupId) throw new HttpError(400, 'Pick a group for the card');
  const r = db
    .prepare('INSERT INTO cards (group_id, item_id, at_s, front, back, origin, pending) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(groupId, itemId, b.atS == null ? null : Number(b.atS), front, back, b.origin === 'ai' ? 'ai' : 'manual', b.pending ? 1 : 0);
  return getCard(Number(r.lastInsertRowid));
}

export function updateCard(id: number, b: any) {
  if (b.front !== undefined) {
    const front = String(b.front).trim();
    if (!front) throw new HttpError(400, 'The front of the card is empty');
    db.prepare('UPDATE cards SET front = ? WHERE id = ?').run(front, id);
  }
  if (b.back !== undefined) db.prepare('UPDATE cards SET back = ? WHERE id = ?').run(String(b.back).trim(), id);
  if (b.groupId !== undefined) db.prepare('UPDATE cards SET group_id = ? WHERE id = ?').run(Number(b.groupId), id);
  // Approving a drafted card puts it in the New pile.
  if (b.pending === false) db.prepare('UPDATE cards SET pending = 0 WHERE id = ?').run(id);
  return getCard(id);
}

export function listCards(url: URL) {
  const where = ['1 = 1'];
  const args: (string | number)[] = [];
  const group = Number(url.searchParams.get('group'));
  if (group) {
    where.push('c.group_id = ?');
    args.push(group);
  }
  const itemId = Number(url.searchParams.get('item'));
  if (itemId) {
    where.push('c.item_id = ?');
    args.push(itemId);
  }
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q) {
    where.push("(c.front LIKE ? ESCAPE '\\' OR c.back LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like);
  }
  const cards = (db.prepare(`${CARD_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.item_id IS NULL, c.item_id, c.at_s, c.id`).all(...args) as any[]).map(toCard);
  const pile = url.searchParams.get('pile');
  return pile ? cards.filter((c) => c.pile === pile) : cards;
}

function newIntroducedToday(): number {
  return (db.prepare("SELECT COUNT(DISTINCT card_id) AS n FROM reviews WHERE day = ? AND state = 'new'").get(localDay()) as any).n;
}

// Cards to review now: ones you're learning, then due reviews, then today's share of new cards.
export function queue(groupId?: number) {
  const now = new Date().toISOString();
  const g = groupId ? 'AND c.group_id = ?' : '';
  const args = groupId ? [groupId] : [];
  const due = db
    .prepare(`${CARD_SELECT} WHERE c.pending = 0 AND c.reps > 0 AND c.due <= ? ${g} ORDER BY c.state = 'review', c.due`)
    .all(now, ...args) as any[];
  const room = Math.max(0, NEW_PER_DAY - newIntroducedToday());
  const fresh = room
    ? (db.prepare(`${CARD_SELECT} WHERE c.pending = 0 AND c.reps = 0 ${g} ORDER BY c.created_at, c.id LIMIT ?`).all(...args, room) as any[])
    : [];
  return [...due, ...fresh].map((r) => ({ ...toCard(r), intervals: preview(memoryOf(r)) }));
}

export function reviewCard(id: number, rating: number) {
  if (![1, 2, 3, 4].includes(rating)) throw new HttpError(400, 'Rating must be 1 to 4');
  const r = db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as any;
  if (!r) throw new HttpError(404, 'Card not found');
  const now = new Date();
  const { memory: m, due } = review(memoryOf(r), rating as Rating, now);
  db.prepare(
    `UPDATE cards SET state = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?, due = ?, last_review = ? WHERE id = ?`,
  ).run(m.state, m.stability, m.difficulty, m.reps, m.lapses, due.toISOString(), now.toISOString(), id);
  db.prepare('INSERT INTO reviews (card_id, rating, state, day, reviewed_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    rating,
    r.state,
    localDay(now),
    now.toISOString(),
  );
  return getCard(id);
}

export function summary() {
  const now = new Date().toISOString();
  const rows = db.prepare('SELECT pending, reps, state, stability, lapses, difficulty FROM cards').all() as any[];
  const piles: Record<Pile, number> = { pending: 0, new: 0, learning: 0, review: 0, mastered: 0, struggling: 0 };
  for (const r of rows) piles[pileOf(r)]++;
  const dueNow = (db.prepare('SELECT COUNT(*) AS n FROM cards WHERE pending = 0 AND reps > 0 AND due <= ?').get(now) as any).n;
  const newToday = Math.min(piles.new, Math.max(0, NEW_PER_DAY - newIntroducedToday()));
  const next = db.prepare('SELECT MIN(due) AS d FROM cards WHERE pending = 0 AND reps > 0 AND due > ?').get(now) as any;
  const reviewedToday = (db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE day = ?').get(localDay()) as any).n;
  return { total: rows.length, piles, due: dueNow + newToday, dueReviews: dueNow, newToday, nextDue: next.d ?? null, reviewedToday };
}

// Solving a problem schedules it to be solved again, as if the first solve were a "Good" review.
export function addProblemCard(itemId: number) {
  const item = db.prepare("SELECT id, title FROM items WHERE id = ? AND kind = 'problem'").get(itemId) as any;
  if (!item || db.prepare("SELECT 1 FROM cards WHERE item_id = ? AND kind = 'problem'").get(itemId)) return;
  const now = new Date();
  const { memory: m, due } = review(newMemory(), 3, now);
  db.prepare(
    `INSERT INTO cards (group_id, item_id, kind, front, origin, state, stability, difficulty, reps, due, last_review)
     VALUES (?, ?, 'problem', ?, 'problem', ?, ?, ?, ?, ?, ?)`,
  ).run(groupOfItem(itemId), itemId, item.title, m.state, m.stability, m.difficulty, m.reps, due.toISOString(), now.toISOString());
}
