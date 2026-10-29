// The Study Buddy server. Change the port here and in manifest.json "host_permissions" if you set PORT.
export const API = 'http://127.0.0.1:7314';

// Same slot order as GROUP_COLORS in src/lib/format.ts, so new groups get the next unused colour.
export const GROUP_COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'];

export async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${API}/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error(`Can't reach Study Buddy at ${API}. Is it running?`), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

// Playlist ids worth importing. Skips Watch Later (WL), Liked (LL, LM), mixes (RD…) and channel uploads (UU…).
export const importable = (id) => /^(PL|OL)[\w-]{10,}$/.test(id);
