import { API, request } from './shared.js';

const $ = (id) => document.getElementById(id);
const show = (view) => ['v-away', 'v-pick', 'v-job'].forEach((v) => ($(v).hidden = v !== view));

let tab = null;
let found = []; // [{ id, title, channel, count }]
let imported = new Map(); // playlist id -> group name already holding it
const picked = new Set();

// ---------- runs inside the YouTube tab ----------

// Collects every playlist linked on the page: saved playlists, a channel's Playlists tab, a playlist page, search results.
function scanPage() {
  const ok = (id) => /^(PL|OL)[\w-]{10,}$/.test(id);
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const found = new Map();
  const add = (id, title, channel, count) => {
    const p = found.get(id) ?? { id, title: '', channel: '', count: '' };
    if (title && title.length > p.title.length && title.length < 200 && !/^(view full playlist|play all)$/i.test(title)) p.title = title;
    if (channel && !p.channel) p.channel = channel;
    if (count && !p.count) p.count = count;
    found.set(id, p);
  };

  const here = new URL(location.href).searchParams.get('list');
  if (here && ok(here) && location.pathname === '/playlist') {
    const h1 = document.querySelector('yt-page-header-view-model h1, ytd-playlist-header-renderer h1, h1');
    add(here, clean(h1?.textContent) || clean(document.title.replace(/ - YouTube$/, '')), '', '');
  }

  for (const a of document.querySelectorAll('a[href*="list="]')) {
    let id;
    try {
      id = new URL(a.href, location.href).searchParams.get('list');
    } catch {
      continue;
    }
    if (!id || !ok(id)) continue;
    const box =
      a.closest('yt-lockup-view-model, ytd-rich-item-renderer, ytd-grid-playlist-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer') ??
      a.parentElement;
    const titleEl = box?.querySelector('h3, #video-title, [class*="lockup-metadata"] [title]');
    const title = clean(titleEl?.getAttribute('title') || titleEl?.textContent || a.getAttribute('title') || a.textContent);
    // On a channel's own page this link reads "Playlist" or "Course", so fall back to the handle in its href.
    const channelEl = box?.querySelector('a[href^="/@"], a[href^="/channel/"]');
    let channel = clean(channelEl?.textContent);
    if (/^(playlist|course|podcast|mix)$/i.test(channel)) channel = channelEl.getAttribute('href').match(/^\/@([^/?]+)/)?.[1] ?? '';
    // innerText keeps the line breaks that textContent drops ("19 videos" + title).
    const count = (box?.innerText ?? '').match(/(\d[\d,]*)\s+(videos?|lessons?)\b/i)?.[1] ?? '';
    add(id, title, channel, count);
  }
  return [...found.values()].map((p) => ({ ...p, title: p.title || p.id }));
}

// Reads a playlist from the open playlist page: scrolls until every video has loaded, then collects them.
// Handles both YouTube layouts: yt-lockup-view-model rows (current) and ytd-playlist-video-renderer (older).
async function readPlaylistPage() {
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const listId = new URL(location.href).searchParams.get('list');
  const rows = () => document.querySelectorAll('ytd-playlist-video-renderer, yt-lockup-view-model');
  let last = -1;
  let still = 0;
  for (let i = 0; i < 300 && still < 4; i++) {
    const n = rows().length;
    if (n === last) still++;
    else {
      still = 0;
      last = n;
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 700));
  }
  window.scrollTo(0, 0);

  const seconds = (t) => t.split(':').reduce((a, p) => a * 60 + Number(p), 0);
  const seen = new Set();
  const videos = [];
  for (const r of rows()) {
    const link = r.querySelector('a#video-title, a[href*="watch?v="]');
    if (!link) continue;
    const url = new URL(link.href, location.href);
    const videoId = url.searchParams.get('v');
    // Lockups also appear in the header, sidebars and shelves. Real rows link to this playlist with an index.
    const isRow = r.tagName !== 'YT-LOCKUP-VIEW-MODEL' || (url.searchParams.get('list') === listId && url.searchParams.has('index'));
    if (!videoId || seen.has(videoId) || !isRow) continue;
    seen.add(videoId);
    const h3 = r.querySelector('h3');
    const title = clean(
      r.querySelector('a#video-title')?.getAttribute('title') || h3?.getAttribute('title') || h3?.textContent || link.textContent,
    );
    const time = (r.innerText || '').split('\n').map(clean).find((t) => /^(\d+:)?\d{1,2}:\d{2}$/.test(t));
    videos.push({ videoId, title, durationS: time ? seconds(time) : 0 });
  }
  const header = document.querySelector('yt-page-header-view-model, ytd-playlist-header-renderer');
  // The tab title is the playlist name; on your own playlists the header's h1 can be the "Playlists" breadcrumb.
  const tabTitle = clean(document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, ''));
  const title = (tabTitle && tabTitle !== 'YouTube' ? tabTitle : '') || clean(header?.querySelector('h1')?.textContent);
  const channelEl = header?.querySelector('a[href^="/@"], a[href^="/channel/"]');
  return { playlistId: listId, title, channel: clean(channelEl?.textContent).replace(/^by\s+/i, ''), videos };
}

// YouTube loads saved playlists as you scroll; scroll to the bottom until nothing new appears.
async function loadAll() {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 60 && still < 3; i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 900));
    const n = document.querySelectorAll('a[href*="list="]').length;
    if (n === last) still++;
    else {
      still = 0;
      last = n;
    }
  }
  window.scrollTo(0, 0);
  return last;
}

const inTab = async (func) => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func }))[0]?.result;

// ---------- popup ----------

async function connect() {
  const conn = $('conn');
  conn.hidden = false;
  try {
    const groups = await request('GET', '/groups');
    imported = new Map();
    for (const g of groups) {
      for (const s of g.sources) {
        const id = new URL(s.url).searchParams.get('list');
        if (id) imported.set(id, g.name);
      }
    }
    conn.textContent = 'Connected';
    conn.className = 'conn';
    fillGroups(groups);
    return true;
  } catch (e) {
    conn.textContent = 'Not running';
    conn.className = 'conn bad';
    conn.title = e.message;
    return false;
  }
}

function fillGroups(groups) {
  const sel = $('group');
  const keep = sel.value;
  // No group is preselected, so a batch never lands in the first group by accident.
  const placeholder = new Option('Choose a group…', '');
  placeholder.disabled = true;
  sel.replaceChildren(placeholder, ...groups.map((g) => new Option(g.name, String(g.id))), new Option('New group…', 'new'));
  sel.value = keep && [...sel.options].some((o) => o.value === keep) ? keep : groups.length ? '' : 'new';
  $('new-group').hidden = sel.value !== 'new';
}

function renderList() {
  const q = $('filter').value.trim().toLowerCase();
  const rows = found.filter((p) => !q || `${p.title} ${p.channel}`.toLowerCase().includes(q));
  const fresh = found.filter((p) => !imported.has(p.id));
  $('found').textContent = found.length
    ? `${found.length} playlist${found.length === 1 ? '' : 's'} on this page`
    : 'No playlists found';
  $('empty').hidden = found.length > 0;
  $('list').replaceChildren(
    ...rows.map((p) => {
      const li = document.createElement('li');
      const already = imported.get(p.id);
      li.className = `item${already ? ' added' : ''}`;
      const box = Object.assign(document.createElement('input'), {
        type: 'checkbox',
        checked: picked.has(p.id),
        disabled: Boolean(already),
      });
      box.setAttribute('aria-label', p.title);
      const text = document.createElement('div');
      text.style.minWidth = '0';
      const t = Object.assign(document.createElement('div'), { className: 't', textContent: p.title, title: p.title });
      const sub = [p.channel, p.count && `${p.count} videos`].filter(Boolean).join(' · ');
      const s = Object.assign(document.createElement('div'), { className: 's', textContent: sub });
      text.append(t, s);
      li.append(box, text);
      if (already) li.append(Object.assign(document.createElement('span'), { className: 'tag', textContent: `In ${already}` }));
      const toggle = () => {
        if (already) return;
        picked.has(p.id) ? picked.delete(p.id) : picked.add(p.id);
        renderList();
      };
      li.addEventListener('click', (e) => e.target !== box && toggle());
      box.addEventListener('change', toggle);
      return li;
    }),
  );
  const all = $('all');
  all.checked = fresh.length > 0 && fresh.every((p) => picked.has(p.id));
  all.indeterminate = !all.checked && fresh.some((p) => picked.has(p.id));
  all.disabled = fresh.length === 0;
  $('picked').textContent = picked.size ? `${picked.size} selected` : '';
  updateImport();
}

function updateImport() {
  const isNew = $('group').value === 'new';
  const chosen = isNew ? Boolean($('new-group').value.trim()) : $('group').value !== '';
  const ready = picked.size > 0 && chosen && $('conn').className === 'conn';
  $('import').disabled = !ready;
  $('import').textContent = picked.size ? `Import ${picked.size} playlist${picked.size === 1 ? '' : 's'}` : 'Import';
}

async function scan() {
  $('found').textContent = 'Scanning…';
  try {
    found = (await inTab(scanPage)) ?? [];
  } catch (e) {
    found = [];
    $('err').textContent = `Couldn't read this page: ${e.message}`;
    $('err').hidden = false;
  }
  for (const id of [...picked]) if (!found.some((p) => p.id === id) || imported.has(id)) picked.delete(id);
  renderList();
}

function renderJob(job) {
  show('v-job');
  const counts = { done: 0, skipped: 0, error: 0 };
  for (const i of job.items) if (i.state in counts) counts[i.state]++;
  const left = job.items.length - counts.done - counts.skipped - counts.error;
  const current = Math.min(job.items.length - left + 1, job.items.length);
  $('job-title').textContent = job.running ? `Importing ${current} of ${job.items.length}…` : 'Import finished';
  $('job-sub').textContent = [
    job.groupName && `Into ${job.groupName}`,
    counts.done && `${counts.done} added`,
    counts.skipped && `${counts.skipped} already there`,
    counts.error && `${counts.error} failed`,
  ]
    .filter(Boolean)
    .join(' · ');
  if (job.running) $('job-sub').textContent += (job.items.length > 1 ? ' · you can close this popup' : '');
  const icon = { done: '✓', skipped: '–', error: '!' };
  $('job-list').replaceChildren(
    ...job.items.map((i) => {
      const li = document.createElement('li');
      li.className = 'item';
      const st = Object.assign(document.createElement('span'), { className: `state ${i.state}`, textContent: icon[i.state] ?? '' });
      const text = document.createElement('div');
      text.style.minWidth = '0';
      text.append(
        Object.assign(document.createElement('div'), { className: 't', textContent: i.title, title: i.title }),
        Object.assign(document.createElement('div'), {
          className: `s${i.state === 'error' ? ' error' : ''}`,
          textContent: i.note || (i.state === 'importing' ? 'Reading the playlist from YouTube…' : i.state === 'waiting' ? 'Waiting' : ''),
        }),
      );
      li.append(st, text);
      return li;
    }),
  );
  $('again').hidden = job.running;
}

function target() {
  const isNew = $('group').value === 'new';
  return { groupId: isNew ? null : Number($('group').value), newGroupName: isNew ? $('new-group').value.trim() : null };
}

async function start(items) {
  const msg = { type: 'import', items, ...target() };
  const r = await chrome.runtime.sendMessage(msg);
  if (!r?.ok) {
    $('err').textContent = r?.error ?? 'Could not start the import.';
    $('err').hidden = false;
    return;
  }
  picked.clear();
}

// ---------- wiring ----------

$('open-saved').addEventListener('click', () => chrome.tabs.update(tab.id, { url: 'https://www.youtube.com/feed/playlists' }).then(() => window.close()));
$('open-app').addEventListener('click', () => chrome.tabs.create({ url: `${API}/#/` }));
$('again').addEventListener('click', async () => {
  await chrome.storage.local.remove('job');
  await connect();
  await openPicker();
});
$('filter').addEventListener('input', renderList);
$('all').addEventListener('change', (e) => {
  for (const p of found) {
    if (imported.has(p.id)) continue;
    e.target.checked ? picked.add(p.id) : picked.delete(p.id);
  }
  renderList();
});
$('group').addEventListener('change', () => {
  $('new-group').hidden = $('group').value !== 'new';
  if (!$('new-group').hidden) $('new-group').focus();
  updateImport();
});
$('new-group').addEventListener('input', updateImport);
$('import').addEventListener('click', () => start(found.filter((p) => picked.has(p.id)).map(({ id, title }) => ({ id, title }))));
$('here-import').addEventListener('click', async () => {
  const btn = $('here-import');
  if ($('group').value === '' || ($('group').value === 'new' && !$('new-group').value.trim())) {
    $('err').textContent = $('group').value === '' ? 'Choose a group first.' : 'Type a name for the new group first.';
    $('err').hidden = false;
    return $('group').value === '' ? $('group').focus() : $('new-group').focus();
  }
  btn.disabled = true;
  btn.textContent = 'Reading videos…';
  try {
    const page = await inTab(readPlaylistPage);
    if (!page?.videos?.length) throw new Error('No videos found on this page. Wait for it to load, then try again.');
    await start([{ id: page.playlistId, title: page.title, page }]);
  } catch (e) {
    $('err').textContent = e.message;
    $('err').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import this page';
  }
});
$('more').addEventListener('click', async () => {
  const btn = $('more');
  btn.disabled = true;
  btn.textContent = 'Scrolling…';
  try {
    await inTab(loadAll);
    await scan();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find more';
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.job?.newValue) renderJob(changes.job.newValue);
});

async function openPicker() {
  if (!tab?.url || !/^https:\/\/(www|m)\.youtube\.com\//.test(tab.url)) return show('v-away');
  show('v-pick');
  const list = new URL(tab.url).searchParams.get('list');
  const onPlaylist = new URL(tab.url).pathname === '/playlist' && list;
  $('here').hidden = !onPlaylist;
  if (onPlaylist) {
    $('here-title').textContent = tab.title.replace(/ - YouTube$/, '');
    const where = imported.get(list);
    $('here-import').disabled = Boolean(where);
    $('here-import').textContent = where ? `In ${where}` : 'Import this page';
  }
  await scan();
}

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const online = await connect();
  const { job } = await chrome.storage.local.get('job');
  if (job) {
    // A job marked running whose worker is gone was cut off; show it as stopped.
    const { running } = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => ({ running: false }));
    if (job.running && !running) {
      job.running = false;
      for (const i of job.items) {
        if (i.state === 'importing' || i.state === 'waiting') Object.assign(i, { state: 'error', note: 'Stopped before it finished. Try again.' });
      }
      await chrome.storage.local.set({ job });
    }
    if (job.running || job.items.length) return renderJob(job);
  }
  await openPicker();
  if (!online) {
    $('err').textContent = `Study Buddy isn't running at ${API}. Start it with "npm start" in the project folder, then reopen this popup.`;
    $('err').hidden = false;
  }
})();
