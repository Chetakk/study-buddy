import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Reads a public YouTube playlist without an API key, from the same JSON the
// playlist page itself uses (ytInitialData), following continuations past 100 videos.

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface PlaylistVideo {
  videoId: string;
  title: string;
  durationS: number;
  thumbnail: string;
}

export interface Playlist {
  playlistId: string;
  title: string;
  channel: string;
  videos: PlaylistVideo[];
}

export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (/^(PL|UU|LL|FL|OL)[\w-]{10,}$/.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed).searchParams.get('list');
  } catch {
    return null;
  }
}

// "1:02:03" -> 3723
export function parseDuration(text: string): number {
  if (!/^\d+(:\d+){0,2}$/.test(text)) return 0;
  return text.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

// Depth-first collect every value stored under `key`, anywhere in `obj`.
function findAll(obj: unknown, key: string, acc: any[] = []): any[] {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === key) acc.push(v);
      findAll(v, key, acc);
    }
  }
  return acc;
}

function videosFrom(data: unknown): PlaylistVideo[] {
  const videos: PlaylistVideo[] = [];
  for (const lockup of findAll(data, 'lockupViewModel')) {
    if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
    const badge = findAll(lockup.contentImage, 'thumbnailBadgeViewModel')[0];
    videos.push({
      videoId: lockup.contentId,
      title: lockup.metadata?.lockupMetadataViewModel?.title?.content ?? 'Untitled',
      durationS: parseDuration(badge?.text ?? ''),
      thumbnail: `https://i.ytimg.com/vi/${lockup.contentId}/mqdefault.jpg`,
    });
  }
  // Older page layout, still served to some clients.
  for (const r of findAll(data, 'playlistVideoRenderer')) {
    videos.push({
      videoId: r.videoId,
      title: r.title?.runs?.[0]?.text ?? r.title?.simpleText ?? 'Untitled',
      durationS: Number(r.lengthSeconds) || 0,
      thumbnail: `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`,
    });
  }
  return videos;
}

function continuationToken(data: unknown): string | null {
  // The newer layout nests continuationCommand inside another continuationCommand;
  // only the inner one carries the token. The first match is the video list's.
  const cmd = findAll(data, 'continuationCommand').find((c) => typeof c.token === 'string');
  return cmd?.token ?? null;
}

// Where the last page that couldn't be read is saved, to see what YouTube changed.
export const FAILED_PAGE = path.join(os.tmpdir(), 'study-buddy-youtube-failed.html');

export class LayoutChanged extends Error {}

function layoutChanged(html: string, what: string): never {
  try {
    fs.writeFileSync(FAILED_PAGE, html);
  } catch {}
  console.error(`YouTube page layout changed (${what}); page saved to ${FAILED_PAGE}`);
  throw new LayoutChanged(
    "Couldn't read this playlist: YouTube seems to have changed its page. Try the Chrome extension, or update Study Buddy.",
  );
}

// Everything the first page gives: title, channel, the first videos and what's needed to load more.
export function parsePlaylistPage(html: string) {
  const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!match) {
    if (/consent\.youtube\.com|before you continue/i.test(html)) throw new Error('YouTube asked for cookie consent; try again later.');
    layoutChanged(html, 'no ytInitialData');
  }
  let data: any;
  try {
    data = JSON.parse(match[1]);
  } catch {
    layoutChanged(html, 'ytInitialData is not JSON');
  }
  if (data.alerts && !data.metadata) throw new Error('Playlist not found or private.');
  const meta = data.metadata?.playlistMetadataRenderer;
  if (!meta) layoutChanged(html, 'no playlistMetadataRenderer');
  const videos = videosFrom(data.contents);
  // A playlist that exists but shows no videos is either empty or a layout we don't recognise.
  if (!videos.length && !/"noResultsText"|"emptyStateRenderer"|This playlist (has no|does not have) videos/i.test(html)) {
    layoutChanged(html, 'no videos found');
  }
  return {
    title: meta.title as string,
    channel: (findAll(data.header, 'avatarStackViewModel')[0]?.text?.content ?? '').replace(/^by\s+/i, '') as string,
    videos,
    token: continuationToken(data.contents),
    apiKey: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1],
    clientVersion: html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1],
  };
}

export async function fetchPlaylist(playlistId: string): Promise<Playlist> {
  const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}&hl=en`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (res.status === 404) throw new Error('Playlist not found or private.');
  if (!res.ok) throw new Error(`YouTube returned ${res.status}`);
  const page = parsePlaylistPage(await res.text());
  const { apiKey, clientVersion } = page;

  const seen = new Set<string>();
  const videos: PlaylistVideo[] = [];
  const add = (list: PlaylistVideo[]) => {
    for (const v of list) {
      if (!seen.has(v.videoId)) {
        seen.add(v.videoId);
        videos.push(v);
      }
    }
  };
  add(page.videos);

  let token = page.token;
  for (let n = 0; token && apiKey && clientVersion && n < 50; n++) {
    const r = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion, hl: 'en' } },
        continuation: token,
      }),
    });
    if (!r.ok) break;
    const more = await r.json();
    const before = videos.length;
    add(videosFrom(more));
    token = continuationToken(more);
    if (videos.length === before) break;
  }

  return {
    playlistId,
    title: page.title,
    channel: page.channel,
    videos,
  };
}
