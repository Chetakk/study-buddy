import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDrafts, tidyTranscript } from '../server/ai.ts';

test('parseDrafts tolerates fences and odd field names', () => {
  const reply = 'Here you go:\n```json\n{"cards":[{"front":"What is a gradient?","back":"Direction of steepest ascent","at":"4:05"},{"question":"Q2","answer":"A2","time":"1:02:03"},{"front":"no back"}]}\n```';
  assert.deepEqual(parseDrafts(reply), [
    { front: 'What is a gradient?', back: 'Direction of steepest ascent', atS: 245 },
    { front: 'Q2', back: 'A2', atS: 3723 },
  ]);
  assert.throws(() => parseDrafts('sorry, no'), /no cards/);
});

test('tidyTranscript joins YouTube transcript time lines', () => {
  assert.equal(tidyTranscript('0:00\nhello there\n0:04\nneurons hold numbers\n'), '[0:00] hello there\n[0:04] neurons hold numbers');
});

// The full route, with a stand-in for Ollama so no model is needed.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-buddy-ai-'));
const PORT = 7900 + Math.floor(Math.random() * 90);
let server: ChildProcess;
let fake: http.Server;
let lastPrompt = '';

before(async () => {
  fake = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    lastPrompt = JSON.parse(body).messages[0].content;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ message: { content: '{"cards":[{"front":"What does a neuron hold?","back":"A number, its activation","at":"0:04"}]}' } }),
    );
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  server = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    env: {
      ...process.env,
      STUDY_BUDDY_DB: path.join(dir, 'study.db'),
      PORT: String(PORT),
      STUDY_BUDDY_AI: 'ollama',
      OLLAMA_URL: `http://127.0.0.1:${(fake.address() as any).port}`,
    },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve, reject) => {
    server.stdout!.on('data', (d) => String(d).includes('Study Buddy API') && resolve());
    server.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(() => {
  server.kill();
  fake.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, url: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: (await r.json()) as any };
};

test('drafted cards land in Pending review, out of the review queue, until approved', async () => {
  assert.deepEqual((await call('GET', '/ai')).data, { provider: 'ollama', model: 'llama3.2', ready: true });
  const g = (await call('POST', '/groups', { name: 'ML' })).data;
  await call('POST', '/sources/from-page', { groupId: g.id, playlistId: 'PLai', title: 'AI', videos: [{ videoId: 'aaaaaaaaaaa', title: 'Neurons', durationS: 600 }] });
  const id = (await call('GET', '/today')).data.resume.id;
  assert.equal((await call('POST', `/items/${id}/draft-cards`, {})).status, 400);

  await call('POST', `/items/${id}/notes`, { atS: 65, body: 'activation = how lit up a neuron is' });
  const r = await call('POST', `/items/${id}/draft-cards`, { transcript: '0:00\nhello\n0:04\nneurons hold numbers' });
  assert.equal(r.data.added, 1);
  assert.ok(lastPrompt.includes('[0:04] neurons hold numbers'));
  assert.ok(lastPrompt.includes('[1:05] activation = how lit up a neuron is'));

  const [card] = (await call('GET', '/cards?pile=pending')).data;
  assert.equal(card.atS, 4);
  assert.equal(card.origin, 'ai');
  assert.equal((await call('GET', '/cards/queue')).data.length, 0);
  await call('PATCH', `/cards/${card.id}`, { pending: false });
  assert.equal((await call('GET', '/cards/queue')).data.length, 1);
});
