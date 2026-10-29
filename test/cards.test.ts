// Card logic straight against a throwaway database (db.ts reads STUDY_BUDDY_DB when first imported).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-buddy-cards-'));
process.env.STUDY_BUDDY_DB = path.join(dir, 'study.db');
const { db } = await import('../server/db.ts');
const { addProblemCard, pileOf, summary } = await import('../server/cards.ts');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('solving a problem adds one card, due in a few days', () => {
  db.exec(`INSERT INTO groups (id, name, color, position) VALUES (1, 'LeetCode', 'blue', 0);
           INSERT INTO sources (id, group_id, kind, external_id, url, title, position) VALUES (1, 1, 'problem_set', 'x', '', 'Two pointers', 0);
           INSERT INTO items (id, source_id, kind, external_id, title, position) VALUES (1, 1, 'problem', 'p1', 'Two Sum', 0);`);
  addProblemCard(1);
  addProblemCard(1);
  const cards = db.prepare('SELECT * FROM cards').all() as any[];
  assert.equal(cards.length, 1);
  assert.equal(cards[0].kind, 'problem');
  assert.equal(cards[0].group_id, 1);
  const days = (Date.parse(cards[0].due) - Date.now()) / 864e5;
  assert.ok(days > 3 && days < 5, `due in ${days} days`);
  assert.equal(summary().due, 0);
});

test('piles', () => {
  const base = { pending: 0, reps: 3, state: 'review', stability: 10, lapses: 0, difficulty: 5 };
  assert.equal(pileOf({ ...base, pending: 1 }), 'pending');
  assert.equal(pileOf({ ...base, reps: 0 }), 'new');
  assert.equal(pileOf(base), 'review');
  assert.equal(pileOf({ ...base, stability: 30 }), 'mastered');
  assert.equal(pileOf({ ...base, lapses: 3 }), 'struggling');
  assert.equal(pileOf({ ...base, state: 'relearning' }), 'learning');
});
