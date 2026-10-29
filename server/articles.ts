// Reads an article's title and length from its page, for a reading-time estimate. No API keys, no parsing library:
// strips scripts, styles and page furniture, then counts the words that are left.

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const WORDS_PER_MIN = 230;
const MAX_BYTES = 4_000_000;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

export function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return null;
  }
}

export function parseArticle(html: string, url: string): { title: string; words: number; readingS: number } {
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)`, 'i'))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, 'i'))?.[1];
  const rawTitle = meta('og:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '';
  const title = decode(rawTitle).replace(/\s+/g, ' ').trim() || new URL(url).hostname;

  // Prefer the <article> or <main> element when there is one; otherwise the whole body.
  const body = html.match(/<article[\s\S]*<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*<\/main>/i)?.[0] ?? html;
  const text = decode(
    body
      .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
  const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
  const readingS = Math.max(60, Math.round((words / WORDS_PER_MIN) * 60));
  return { title: title.slice(0, 300), words, readingS };
}

export async function fetchArticle(url: string) {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("Couldn't load that page");
  }
  if (!res.ok) throw new Error(`The page returned ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/html|xml|text\/plain/.test(type)) throw new Error("That link isn't a web page");
  const buf = await res.arrayBuffer();
  return parseArticle(new TextDecoder().decode(buf.slice(0, MAX_BYTES)), res.url || url);
}
