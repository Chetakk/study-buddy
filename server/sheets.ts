// Reads a public Google Sheet of coding problems (CSV export) into sections, one per pattern.
// Layout it expects, as in the "one question daily" sheet: a heading row per pattern with no links,
// then one row per problem: [sub-concept?, title (difficulty)?, link, link, link]. A row with only
// links continues the problem above it with more problems.

export interface Problem {
  key: string; // stable id within its section, so re-syncing keeps progress
  title: string;
  url: string;
  difficulty: '' | 'easy' | 'medium' | 'hard';
  concept: string;
  challenge: boolean;
  homework: boolean;
  links: { label: string; url: string }[]; // other practice links and video explanations
}

export interface Section {
  slug: string;
  title: string;
  problems: Problem[];
}

export function parseSheetUrl(input: string): { id: string; gid: string } | null {
  const m = input.trim().match(/docs\.google\.com\/spreadsheets\/d\/([\w-]{20,})/);
  if (!m) return null;
  const gid = input.match(/[#?&]gid=(\d+)/)?.[1] ?? '0';
  return { id: m[1], gid };
}

export async function fetchSheet(id: string, gid: string): Promise<string[][]> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`, { redirect: 'follow' });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('csv')) {
    throw new Error('Could not read the sheet. In Google Sheets, set Share → General access to "Anyone with the link".');
  }
  return parseCsv(await res.text());
}

// RFC 4180: quoted fields may hold commas, newlines and doubled quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const isUrl = (s: string) => /^https?:\/\//i.test(s.trim());
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// "1. Pattern: Two Pointers" -> "Two Pointers", "HEAP PATTERN" -> "Heap", "DP (Dynamic Programming)" -> "Dynamic Programming"
function sectionTitle(raw: string): string {
  const inner = raw.match(/\(([^)]+)\)\s*$/)?.[1];
  let t = clean(inner ?? raw)
    .replace(/^\d+\.\s*/, '')
    .replace(/\bpattern\b\s*:?/gi, '')
    .replace(/^\s*:\s*/, '')
    .replace(/\s+and\s+/i, ' & ');
  t = clean(t);
  if (t === t.toUpperCase()) t = t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return t || clean(raw);
}

// A heading row has no links and either says "pattern" or starts with a capitalised word (GRAPHS, DP, HEAP…).
const isHeading = (title: string, links: string[]) => !links.length && (/pattern/i.test(title) || /^[A-Z]{2,}\b/.test(title));

function cleanUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k);
    if (url.hostname.endsWith('leetcode.com')) url.pathname = url.pathname.replace(/\/(description|editorial|solutions)\/?$/, '/');
    return url.toString();
  } catch {
    return u.trim();
  }
}

// leetcode.com/problems/best-time-to-buy-and-sell-stock-ii/ -> "Best Time To Buy And Sell Stock II"
function titleFromUrl(u: string): string {
  const slug = u.match(/\/problems\/([^/?#]+)/)?.[1] ?? '';
  return slug
    .replace(/\d{3,}$/, '')
    .split('-')
    .filter(Boolean)
    .map((w) => (/^(i{1,3}|iv|ii)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function linkLabel(u: string): string {
  if (/youtu\.?be/.test(u)) return 'Video explanation';
  if (/leetcode\.com/.test(u)) return `LeetCode: ${titleFromUrl(u)}`;
  if (/geeksforgeeks\.org/.test(u)) return 'GeeksforGeeks';
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

export function parseProblems(rows: string[][]): Section[] {
  const sections: Section[] = [];
  let section: Section | null = null;
  let concept = '';
  let last: Problem | null = null;

  for (const raw of rows) {
    const cells = raw.map((c) => clean(c ?? ''));
    const [conceptCell = '', titleCell = '', ...rest] = cells;
    const links = rest.filter(isUrl).map(cleanUrl);
    const homework = rest.some((c) => /^homework$/i.test(c));
    if (/^question$/i.test(titleCell) || (!titleCell && !links.length)) continue; // header row or blank

    if (isHeading(titleCell, links)) {
      const title = sectionTitle(titleCell);
      section = { slug: slugify(title), title, problems: [] };
      sections.push(section);
      concept = '';
      last = null;
      continue;
    }
    if (!section) continue; // rows above the first pattern (the sheet's title)
    if (conceptCell) concept = conceptCell;

    // Links with no title: more problems that belong with the one above (e.g. Buy & Sell Stock II, III, IV).
    if (!titleCell) {
      for (const url of links.filter((l) => !/youtu\.?be/.test(l))) {
        if (section.problems.some((p) => p.key === url)) continue;
        const title = titleFromUrl(url) || linkLabel(url);
        section.problems.push({ key: url, title, url, difficulty: last?.difficulty ?? '', concept, challenge: false, homework: false, links: [] });
      }
      continue;
    }

    const diffMatch = titleCell.match(/\((easy|med(?:ium)?|hard?|ha)\)?/i);
    const d = diffMatch?.[1].toLowerCase() ?? '';
    const difficulty: Problem['difficulty'] = d.startsWith('e') ? 'easy' : d.startsWith('m') ? 'medium' : d.startsWith('h') ? 'hard' : '';
    const challenge = /problem\s+challenge/i.test(titleCell);
    const title = clean(
      titleCell
        .replace(/\((easy|med(?:ium)?|hard?|ha)\)?/i, '')
        .replace(/\(?problem\s+challenge\)?(\s*\d+)?\s*:?/i, '')
        .replace(/\s+-\s*$/, ''),
    );
    const practice = links.filter((l) => !/youtu\.?be/.test(l));
    const url = practice[0] ?? '';
    const key = url || `title:${slugify(title)}`;
    if (section.problems.some((p) => p.key === key)) continue; // the sheet lists a few problems twice
    last = {
      key,
      title,
      url,
      difficulty,
      concept,
      challenge,
      homework,
      links: [...practice.slice(1), ...links.filter((l) => /youtu\.?be/.test(l))].map((u) => ({ label: linkLabel(u), url: u })),
    };
    section.problems.push(last);
  }
  return sections.filter((s) => s.problems.length);
}
