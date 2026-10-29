import { notifyChanged } from './events.ts';

// JARVIS (the voice assistant) steers open pages through the server (server/remote.ts): go to a page, press one
// of the keyboard shortcuts, add a note, mark the video done or play/pause/seek/set the speed on the Watch page,
// or refetch after it changed something. Reconnecting on every route change tells the server where this page is.
let source: EventSource | null = null;

function connect() {
  source?.close();
  source = new EventSource(`/api/remote?at=${encodeURIComponent(location.hash || '#/')}`);
  source.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.go) location.hash = msg.go;
    if (msg.key) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: msg.key, bubbles: true }));
    if (msg.note) window.dispatchEvent(new CustomEvent('sb:note', { detail: msg.note }));
    if (msg.done) window.dispatchEvent(new Event('sb:done'));
    if (msg.player) window.dispatchEvent(new CustomEvent('sb:player', { detail: msg.player }));
    if (msg.changed) {
      notifyChanged();
      window.dispatchEvent(new Event('sb:remote'));
    }
  };
}

export function startRemote() {
  connect();
  window.addEventListener('hashchange', connect);
}
