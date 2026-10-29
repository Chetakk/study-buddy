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

export async function fetchPlaylist(playlistId: string): Promise<Playlist> {
  const res = await fetch(`https://www.youtube.com/playlist?list=${playlistId}&hl=en`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`YouTube returned ${res.status}`);
  const html = await res.text();
  const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!match) throw new Error('Could not read the playlist page. Is the playlist public?');
  const data = JSON.parse(match[1]);

  const meta = data.metadata?.playlistMetadataRenderer;
  if (!meta) throw new Error('Playlist not found or private.');
  const channelText: string =
    findAll(data.header, 'avatarStackViewModel')[0]?.text?.content ?? '';

  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];

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
  add(videosFrom(data.contents));

  let token = continuationToken(data.contents);
  for (let page = 0; token && apiKey && clientVersion && page < 50; page++) {
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
    title: meta.title,
    channel: channelText.replace(/^by\s+/i, ''),
    videos,
  };
}
