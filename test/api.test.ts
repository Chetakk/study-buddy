// Runs the real server against a throwaway database and checks progress, status and streak behaviour.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
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
