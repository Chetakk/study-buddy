import type http from 'node:http';
import { HttpError } from './http.ts';

// JARVIS (the voice assistant) steers the open pages of the app: GET /api/remote is an event stream each page
// listens on, POST /api/remote sends them one message. Pages reconnect with ?at=<hash route> whenever they move,
// so GET /api/remote/pages says what's open and where.
interface Page {
  res: http.ServerResponse;
  at: string;
  since: number;
}
const pages = new Set<Page>();

// Keys a page may be sent: the app's own shortcuts (see Watch.tsx and Review.tsx).
const KEYS = new Set(['k', ' ', 'j', 'l', '<', '>', 'f', 'n', 'c', 'Escape', 'Enter', '1', '2', '3', '4', '[']);

export function listen(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.write(': open\n\n');
  const page = { res, at: (url.searchParams.get('at') || '#/').slice(0, 200), since: Date.now() };
  pages.add(page);
  req.on('close', () => pages.delete(page));
}

export const openPages = () => [...pages].map(({ at, since }) => ({ at, since }));

// {go: '#/watch/34'}, {key: 'k'}, {note: 'text'} (at the video's current time), {done: true} (mark the video
// being watched done), {player: {do: 'play' | 'pause' | 'seek' | 'speed', by, to}}, {changed: true} (refetch:
// JARVIS changed something through the API).
export function send(b: any) {
  const msg: Record<string, unknown> = {};
  if (b.go !== undefined) {
    if (typeof b.go !== 'string' || !b.go.startsWith('#/')) throw new HttpError(400, 'go needs a #/ route');
    msg.go = b.go.slice(0, 200);
  }
  if (b.key !== undefined) {
    if (!KEYS.has(b.key)) throw new HttpError(400, 'Not one of the app\'s keys');
    msg.key = b.key;
  }
  if (b.note !== undefined) {
    const note = String(b.note).trim();
    if (!note) throw new HttpError(400, 'Note is empty');
    msg.note = note.slice(0, 4000);
  }
  if (b.done) msg.done = true;
  if (b.player !== undefined) {
    const c = b.player ?? {};
    if (!['play', 'pause', 'seek', 'speed'].includes(c.do)) throw new HttpError(400, 'player.do is play, pause, seek or speed');
    msg.player = { do: c.do, by: Number(c.by) || 0, to: Number(c.to) || 1 };
  }
  if (b.changed) msg.changed = true;
  if (!Object.keys(msg).length) throw new HttpError(400, 'Nothing to send');
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const p of pages) p.res.write(line);
  return { pages: pages.size };
}

// A comment now and then, so a page that went away without closing is noticed.
setInterval(() => {
  for (const p of pages) p.res.write(': ping\n\n');
}, 25_000).unref();
