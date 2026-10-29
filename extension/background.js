// Runs imports one playlist at a time, so the popup can close while a long batch finishes.
// Progress lives in chrome.storage.local under "job"; the popup just renders it.
import { GROUP_COLORS, request } from './shared.js';

let running = false;

const save = (job) => chrome.storage.local.set({ job });

async function run({ items, groupId, newGroupName }) {
  running = true;
  const job = {
    running: true,
    groupName: newGroupName ?? '',
    items: items.map((i) => ({ ...i, state: 'waiting', note: '' })),
  };
  await save(job);

  try {
    if (newGroupName) {
      const groups = await request('GET', '/groups');
      const used = groups.map((g) => g.color);
      const color = GROUP_COLORS.find((c) => !used.includes(c)) ?? GROUP_COLORS[used.length % GROUP_COLORS.length];
      groupId = (await request('POST', '/groups', { name: newGroupName, color })).id;
    } else {
      const groups = await request('GET', '/groups');
      job.groupName = groups.find((g) => g.id === groupId)?.name ?? '';
    }
  } catch (e) {
    job.items.forEach((i) => Object.assign(i, { state: 'error', note: e.message }));
    job.running = false;
    running = false;
    return save(job);
  }

  for (const item of job.items) {
    item.state = 'importing';
    await save(job);
    try {
      // Playlists read from the page come with their videos; others are fetched by the server.
      const r = item.page
        ? await request('POST', '/sources/from-page', { groupId, ...item.page })
        : await request('POST', '/sources', { groupId, url: `https://www.youtube.com/playlist?list=${item.id}` });
      Object.assign(item, { state: 'done', note: `${r.count} videos` });
    } catch (e) {
      // 409 means it's already in Study Buddy, which is fine.
      let note = e.message;
      if (/private|not found/i.test(note)) note = 'This playlist is private. Open it on YouTube and use "Import this page".';
      Object.assign(item, e.status === 409 ? { state: 'skipped', note } : { state: 'error', note });
    }
    delete item.page; // the video list isn't needed once it's sent
    await save(job);
  }
  job.running = false;
  running = false;
  await save(job);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  // The popup asks this to tell a live import from one cut off when the worker was stopped.
  if (msg.type === 'status') return reply({ running });
  if (msg.type !== 'import') return;
  if (running) reply({ ok: false, error: 'An import is already running.' });
  else {
    run(msg);
    reply({ ok: true });
  }
});

// A service worker restart mid-import leaves a stale "running" job behind; mark it as stopped.
chrome.runtime.onStartup.addListener(async () => {
  const { job } = await chrome.storage.local.get('job');
  if (job?.running) {
    job.running = false;
    for (const i of job.items) {
      if (i.state === 'importing' || i.state === 'waiting') Object.assign(i, { state: 'error', note: 'Stopped before it finished. Try again.' });
    }
    save(job);
  }
});

