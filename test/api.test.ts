// Runs the real server against a throwaway database and checks progress, status and streak behaviour.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-buddy-test-'));
const PORT = 7400 + Math.floor(Math.random() * 500);
let server: ChildProcess;

const call = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: (await r.json()) as any };
};

before(async () => {
  server = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'],
    { env: { ...process.env, STUDY_BUDDY_DB: path.join(dir, 'study.db'), PORT: String(PORT) }, stdio: 'pipe' },
  );
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on('data', (d) => String(d).includes('Study Buddy API') && resolve());
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
  // Seed one playlist with two videos straight through the extension route (no network).
  const g = await call('POST', '/groups', { name: 'ML' });
  await call('POST', '/sources/from-page', {
    groupId: g.data.id,
    playlistId: 'PLtest',
    title: 'Test list',
    videos: [
      { videoId: 'aaaaaaaaaaa', title: 'One', durationS: 100 },
      { videoId: 'bbbbbbbbbbb', title: 'Two', durationS: 200 },
    ],
  });
});

after(() => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

const firstItem = async () => (await call('GET', '/today')).data.resume.id as number;

test('progress merges segments and becomes done at 90%', async () => {
  const id = await firstItem();
  let r = await call('POST', `/items/${id}/progress`, { segments: [[0, 40]], positionS: 40, playedS: 40 });
  assert.equal(r.data.status, 'in_progress');
  assert.equal(r.data.watchedS, 40);
  // Rewatching the same part adds nothing.
  r = await call('POST', `/items/${id}/progress`, { segments: [[10, 40]], positionS: 40, playedS: 30 });
  assert.equal(r.data.watchedS, 40);
  r = await call('POST', `/items/${id}/progress`, { segments: [[40, 90]], positionS: 90, playedS: 50 });
  assert.equal(r.data.status, 'done');
  assert.ok(r.data.completedAt);
});

test('resume moves on to the next unfinished video', async () => {
  const r = await call('GET', '/today');
  assert.equal(r.data.resume.title, 'Two');
  assert.equal(r.data.studiedTodayS, 120);
  assert.equal(r.data.streak, 1);
});

test('marking undone keeps watched time as in progress', async () => {
  const one = (await call('GET', '/groups')).data[0];
  const src = (await call('GET', `/sources/${one.sources[0].id}`)).data;
  const id = src.items[0].id;
  const r = await call('POST', `/items/${id}/status`, { done: false });
  assert.equal(r.data.status, 'in_progress');
});

test('played time per call is capped', async () => {
  const before = (await call('GET', '/today')).data.studiedTodayS;
  const id = await firstItem();
  await call('POST', `/items/${id}/progress`, { segments: [], positionS: 0, playedS: 10_000 });
  assert.equal((await call('GET', '/today')).data.studiedTodayS - before, 120);
});

test('rejects requests from other websites', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/groups`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('export then import round-trips the data', async () => {
  const exp = (await call('GET', '/export')).data;
  await call('POST', '/groups', { name: 'Temp' });
  const r = await call('POST', '/import', exp);
  assert.equal(r.data.counts.groups, 1);
  assert.equal((await call('GET', '/groups')).data.length, 1);
  assert.equal((await call('POST', '/import', { nope: 1 })).status, 400);
});

test('notes are listed, searched and found by the palette', async () => {
  const id = await firstItem();
  await call('POST', `/items/${id}/notes`, { atS: 42.5, body: 'Backprop uses the **chain rule**' });
  const all = (await call('GET', '/notes')).data;
  assert.equal(all.length, 1);
  assert.equal(all[0].itemTitle, 'Two');
  assert.equal((await call('GET', '/notes?q=chain')).data.length, 1);
  assert.equal((await call('GET', '/notes?q=nothing')).data.length, 0);
  const hit = (await call('GET', '/search?q=chain')).data.find((h: any) => h.kind === 'Note');
  assert.equal(hit.href, `#/watch/${id}?t=42`);
});

test('skipped videos stop counting and are passed over', async () => {
  const g = (await call('GET', '/groups')).data[0];
  const src = (await call('GET', `/sources/${g.sources[0].id}`)).data;
  const two = src.items.find((i: any) => i.title === 'Two');
  await call('POST', `/items/${two.id}/skip`, { skipped: true });
  const after = (await call('GET', `/sources/${src.id}`)).data;
  assert.equal(after.total, 1);
  assert.equal(after.durationS, 100);
  assert.equal(after.items.find((i: any) => i.id === two.id).skipped, true);
  assert.notEqual((await call('GET', '/today')).data.resume?.id, two.id);
  await call('POST', `/items/${two.id}/skip`, { skipped: false });
  assert.equal((await call('GET', `/sources/${src.id}`)).data.total, 2);
});

test('replaying a long-finished video records a rewatch', async () => {
  const g = (await call('GET', '/groups')).data[0];
  const one = (await call('GET', `/sources/${g.sources[0].id}`)).data.items.find((i: any) => i.title === 'One');
  await call('POST', `/items/${one.id}/status`, { done: true });
  const r = await call('POST', `/items/${one.id}/progress`, { segments: [[0, 5]], positionS: 5, playedS: 5 });
  // Finished moments ago: not a rewatch yet.
  assert.equal(r.data.rewatchedAt, null);
  assert.equal(r.data.status, 'done');
});

test('cards: create, queue, review and piles', async () => {
  const id = await firstItem();
  const card = (await call('POST', '/cards', { front: 'What is a gradient?', back: 'Direction of steepest ascent', itemId: id, atS: 30 })).data;
  assert.equal(card.pile, 'new');
  assert.equal(card.groupName, 'ML');
  assert.equal((await call('POST', '/cards', { front: '' })).status, 400);

  let q = (await call('GET', '/cards/queue')).data;
  assert.equal(q.length, 1);
  assert.ok(q[0].intervals[3] > q[0].intervals[1]);

  const after = (await call('POST', `/cards/${card.id}/review`, { rating: 3 })).data;
  assert.equal(after.reps, 1);
  assert.equal(after.pile, 'learning');
  q = (await call('GET', '/cards/queue')).data;
  assert.equal(q.length, 0);
  const sum = (await call('GET', '/cards/summary')).data;
  assert.equal(sum.reviewedToday, 1);
  assert.equal(sum.due, 0);
  assert.ok(sum.nextDue);
  assert.equal((await call('GET', '/cards?pile=learning')).data.length, 1);
  assert.equal((await call('GET', '/cards?q=gradient')).data.length, 1);
});

test('daily goal is saved and today shows time per group', async () => {
  const g = (await call('GET', '/groups')).data[0];
  await call('PATCH', `/groups/${g.id}`, { goalMin: 30 });
  const t = (await call('GET', '/today')).data.groups.find((x: any) => x.id === g.id);
  assert.equal(t.goalMin, 30);
  assert.ok(t.todayS > 0);
  await call('PATCH', `/groups/${g.id}`, { goalMin: -5 });
  assert.equal((await call('GET', '/groups')).data[0].goalMin, 0);
});

test('suggestions include a nearly finished video', async () => {
  const g = (await call('GET', '/groups')).data[0];
  const src = (await call('POST', '/sources/from-page', {
    groupId: g.id,
    playlistId: 'PLsuggest',
    title: 'Suggest list',
    videos: [{ videoId: 'ccccccccccc', title: 'Almost', durationS: 600 }],
  })).data;
  const item = (await call('GET', `/sources/${src.id}`)).data.items[0];
  await call('POST', `/items/${item.id}/progress`, { segments: [[0, 400]], positionS: 400, playedS: 10 });
  const s = (await call('GET', '/suggestions')).data;
  assert.ok(s.some((x: any) => x.id === `finish-${item.id}` && x.text.includes('about 3 min left')), JSON.stringify(s));
});

test('playback on youtube.com is tracked by video id, preferring the playing list', async () => {
  const r = await call('POST', '/track', { videoId: 'ccccccccccc', listId: 'PLsuggest', segments: [[400, 600]], positionS: 600, playedS: 30 });
  assert.equal(r.data.tracked, true);
  assert.equal(r.data.status, 'done');
  assert.equal((await call('POST', '/track', { videoId: 'zzzzzzzzzzz', segments: [[0, 10]] })).data.tracked, false);
  assert.equal((await call('POST', '/track', { videoId: 'bad' })).status, 400);
});

test('articles go into a reading list and count their reading time when read', async () => {
  const page = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<title>A post</title><article>${'word '.repeat(690)}</article>`);
  });
  await new Promise<void>((r) => page.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(page.address() as any).port}/post?utm_source=x`;
  try {
    const g = (await call('GET', '/groups')).data[0];
    const r = await call('POST', '/articles', { groupId: g.id, url });
    assert.equal(r.data.title, 'A post');
    assert.equal(r.data.minutes, 3);
    assert.equal((await call('POST', '/articles', { groupId: g.id, url })).status, 409);
    const detail = (await call('GET', `/groups/${g.id}`)).data;
    const list = detail.sources.find((s: any) => s.kind === 'articles');
    assert.equal(list.items.length, 1);
    const before = (await call('GET', '/today')).data.studiedTodayS;
    await call('POST', `/items/${r.data.id}/status`, { done: true });
    await call('POST', `/items/${r.data.id}/status`, { done: false });
    await call('POST', `/items/${r.data.id}/status`, { done: true });
    assert.equal((await call('GET', '/today')).data.studiedTodayS - before, 180);
  } finally {
    page.close();
  }
});

test('remote: open pages get what JARVIS sends, and say where they are', async () => {
  const got: string[] = [];
  const req = http.get(`http://127.0.0.1:${PORT}/api/remote?at=${encodeURIComponent('#/watch/3')}`);
  const res = await new Promise<http.IncomingMessage>((r) => req.on('response', r));
  res.setEncoding('utf8');
  res.on('data', (d: string) => got.push(d));
  try {
    assert.deepEqual((await call('GET', '/remote/pages')).data.map((p: any) => p.at), ['#/watch/3']);
    assert.equal((await call('POST', '/remote', { key: 'k' })).data.pages, 1);
    assert.equal((await call('POST', '/remote', { key: 'x' })).status, 400);
    assert.equal((await call('POST', '/remote', { go: 'https://example.com' })).status, 400);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(got.join('').includes('data: {"key":"k"}'));
  } finally {
    req.destroy();
  }
});
