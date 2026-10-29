import { useMemo, useState, type CSSProperties } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { notifyChanged } from '../lib/events.ts';
import { colorVar, fmtClock, fmtDuration, pct, ratio } from '../lib/format.ts';
import { Bar, ErrorBox, Loading, Ring, Thumb } from '../components/ui.tsx';
import { Check, External, Play, Plus, Search } from '../components/icons.tsx';
import { ProblemRows } from './Source.tsx';
import type { GroupDetail, GroupSource, ListItem, Status } from '../types.ts';

const cVar = (color: string) => ({ '--c': colorVar(color) }) as CSSProperties;

export function GroupPage({ id }: { id: number }) {
  const { data: g, error, reload } = useLoad(() => api.get<GroupDetail>(`/groups/${id}`), id);

  if (error) return <ErrorBox message={error} />;
  if (!g) return <Loading />;

  const changed = () => {
    reload();
    notifyChanged();
  };
  const videos = g.sources.filter((s) => s.kind !== 'problem_set');
  const patterns = g.sources.filter((s) => s.kind === 'problem_set');
  const nextVideo = g.upNext[0];
  const nextProblem = patterns.map((s) => s.next).find(Boolean);

  return (
    <div className="stack group-page" style={cVar(g.color)}>
      <div className="page-head">
        <div className="gp-title">
          <Ring done={g.done} total={g.total} color={g.color} size={64} />
          <div style={{ minWidth: 0 }}>
            <a href="#/library" className="eyebrow">
              Group
            </a>
            <h1>{g.name}</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              {summary(g, videos.length > 0, patterns.length > 0)}
            </p>
          </div>
        </div>
        <div className="row wrap">
          <button
            className={`btn${g.onToday ? ' on-today' : ''}`}
            onClick={() => api.patch(`/groups/${g.id}`, { onToday: !g.onToday }).then(changed)}
            aria-pressed={g.onToday}
            title={g.onToday ? 'Shown on the Today page. Click to hide it there.' : 'Show this group on the Today page'}
          >
            {g.onToday ? <Check /> : <Plus />} {g.onToday ? 'On Today' : 'Add to Today'}
          </button>
          {nextVideo ? (
            <a className="btn btn-primary" href={`#/watch/${nextVideo.id}`}>
              <Play /> {nextVideo.status === 'in_progress' ? `Resume at ${fmtClock(nextVideo.positionS)}` : 'Start next video'}
            </a>
          ) : nextProblem?.url ? (
            <a className="btn btn-primary" href={nextProblem.url} target="_blank" rel="noreferrer">
              <External /> Next problem
            </a>
          ) : null}
        </div>
      </div>

      {g.sources.length === 0 && (
        <div className="card empty">
          <h2>Nothing in this group yet</h2>
          <p>Add a YouTube playlist or a problem sheet to it in the Library.</p>
          <p style={{ marginTop: 16 }}>
            <a className="btn btn-primary" href="#/library">
              Go to Library
            </a>
          </p>
        </div>
      )}

      {videos.length > 0 && <VideoSection g={g} sources={videos} />}
      {patterns.length > 0 && <ProblemSection color={g.color} patterns={patterns} onChange={changed} />}
    </div>
  );
}

function summary(g: GroupDetail, hasVideos: boolean, hasProblems: boolean) {
  const n = (x: number, word: string) => `${x} ${word}${x === 1 ? '' : 's'}`;
  if (hasProblems && !hasVideos) return `${g.done} of ${n(g.total, 'problem')} solved`;
  const parts = [`${g.done} of ${n(g.total, hasProblems ? 'item' : 'video')} done`];
  if (g.durationS) parts.push(g.watchedS >= 60 ? `${fmtDuration(g.watchedS)} of ${fmtDuration(g.durationS)} watched` : `${fmtDuration(g.durationS)} of video`);
  return parts.join(' · ');
}

// ---------- videos ----------

// Playlists you're partway through come first (most recent on top), then untouched ones, then finished ones.
function playlistOrder(a: GroupSource, b: GroupSource) {
  const rank = (s: GroupSource) => (s.total > 0 && s.done === s.total ? 2 : s.lastAt ? 0 : 1);
  return rank(a) - rank(b) || (b.lastAt ?? '').localeCompare(a.lastAt ?? '');
}

function VideoSection({ g, sources }: { g: GroupDetail; sources: GroupSource[] }) {
  const ordered = [...sources].sort(playlistOrder);
  return (
    <>
      {g.upNext.length > 0 && (
        <section className="card" aria-labelledby="gp-next">
          <h2 id="gp-next" style={{ marginBottom: 8 }}>
            Up next
          </h2>
          <div className="list">
            {g.upNext.map((v) => (
              <a key={v.id} href={`#/watch/${v.id}`} className="list-row gp-next-row">
                <Thumb src={v.thumbnail} durationS={v.durationS} watched={ratio(v.watchedS, v.durationS)} color={g.color} />
                <div className="video-meta">
                  <div className="video-title">{v.title}</div>
                  <div className="video-sub">
                    {v.status === 'in_progress' ? (
                      <b>
                        Resume at {fmtClock(v.positionS)} · {pct(v.watchedS, v.durationS)} watched
                      </b>
                    ) : (
                      v.sourceTitle
                    )}
                  </div>
                </div>
                <span className="icon-btn" aria-hidden>
                  <Play />
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="gp-pl">
        <h2 id="gp-pl" className="section-h">
          Playlists <span className="subtle mono">{sources.length}</span>
        </h2>
        <div className="pl-grid">
          {ordered.map((s) => {
            const finished = s.total > 0 && s.done === s.total;
            return (
              <a key={s.id} href={`#/source/${s.id}`} className="card pl-card">
                <span className="vthumb">
                  {s.next?.thumbnail && <img src={s.next.thumbnail} alt="" loading="lazy" />}
                  {finished && (
                    <span className="pl-done">
                      <Check /> Finished
                    </span>
                  )}
                </span>
                <span className="pl-body">
                  <span className="pl-title">{s.title}</span>
                  <span className="subtle pl-sub">
                    {s.channel && `${s.channel} · `}
                    {s.total} videos · {fmtDuration(s.durationS)}
                  </span>
                  <Bar value={ratio(s.done, s.total)} color={g.color} size="sm" label={`${s.title} progress`} />
                  <span className="pl-sub">
                    <span className="mono">
                      {s.done}/{s.total}
                    </span>
                    {!finished && s.next && <span className="subtle"> · Next: {s.next.title}</span>}
                  </span>
                </span>
              </a>
            );
          })}
        </div>
      </section>
    </>
  );
}

// ---------- problems ----------

const DIFFS = [
  ['easy', 'Easy'],
  ['medium', 'Medium'],
  ['hard', 'Hard'],
] as const;

const STATUS: [string, string, (s: Status) => boolean][] = [
  ['all', 'All', () => true],
  ['left', 'To solve', (s) => s !== 'done'],
  ['done', 'Solved', (s) => s === 'done'],
];

function ProblemSection({ color, patterns, onChange }: { color: string; patterns: GroupSource[]; onChange: () => void }) {
  const [query, setQuery] = useState('');
  const [diff, setDiff] = useState('all');
  const [status, setStatus] = useState('all');
  // Patterns are worked through in sheet order: the first unfinished one is the current one.
  const current = patterns.find((p) => p.done < p.total)?.id;
  const [open, setOpen] = useState<Set<number>>(() => new Set(current ? [current] : []));

  const all = useMemo(() => patterns.flatMap((p) => p.items ?? []), [patterns]);
  const filtering = query.trim() !== '' || diff !== 'all' || status !== 'all';
  // Search matches the problem, its sub-topic, or the pattern it belongs to.
  const test = (i: ListItem, pattern: string) =>
    (diff === 'all' || i.meta.difficulty === diff) &&
    STATUS.find((s) => s[0] === status)![2](i.status) &&
    (!query.trim() || `${i.title} ${i.meta.concept ?? ''} ${pattern}`.toLowerCase().includes(query.trim().toLowerCase()));

  const next = patterns.find((p) => p.id === current)?.next;
  const solve = (id: number, s: Status) => api.post(`/items/${id}/status`, { done: s !== 'done' }).then(onChange);
  const toggleOpen = (id: number) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const counts = DIFFS.map(([key, label]) => {
    const items = all.filter((i) => i.meta.difficulty === key);
    return { key, label, done: items.filter((i) => i.status === 'done').length, total: items.length };
  });
  const unrated = all.filter((i) => !i.meta.difficulty);

  return (
    <>
      <div className="prob-top">
        {next && (
          <section className="card next-prob" aria-label="Next problem">
            <div className="eyebrow">Next problem</div>
            <div className="next-prob-row">
              <span className={`pbadge diff-${next.meta.difficulty || 'none'}`}>{(next.meta.difficulty || '?')[0].toUpperCase()}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 className="np-title">{next.title}</h2>
                <p className="subtle" style={{ fontSize: 13 }}>
                  {next.sourceTitle}
                  {next.meta.concept && ` · ${next.meta.concept}`}
                  {next.meta.difficulty && ` · ${next.meta.difficulty[0].toUpperCase()}${next.meta.difficulty.slice(1)}`}
                </p>
              </div>
            </div>
            <div className="row wrap">
              {next.url && (
                <a className="btn btn-primary" href={next.url} target="_blank" rel="noreferrer">
                  <External /> Open problem
                </a>
              )}
              <button className="btn" onClick={() => solve(next.id, next.status)}>
                <Check /> Mark solved
              </button>
              {next.meta.links?.slice(0, 2).map((l) => (
                <a key={l.url} className="prob-link" href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  {l.label}
                </a>
              ))}
            </div>
          </section>
        )}

        <section className="card diff-card" aria-label="Solved by difficulty">
          {counts.map((c) => (
            <div key={c.key} className="diff-stat">
              <span className={`diff-${c.key}`}>{c.label}</span>
              <b className="mono">
                {c.done}
                <small>/{c.total}</small>
              </b>
              <Bar value={ratio(c.done, c.total)} color={color} size="sm" label={`${c.label} solved`} />
            </div>
          ))}
          {unrated.length > 0 && (
            <div className="diff-stat">
              <span className="subtle">Unrated</span>
              <b className="mono">
                {unrated.filter((i) => i.status === 'done').length}
                <small>/{unrated.length}</small>
              </b>
              <Bar value={ratio(unrated.filter((i) => i.status === 'done').length, unrated.length)} color={color} size="sm" label="Unrated solved" />
            </div>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="gp-patterns">
        <div className="spread wrap prob-tools">
          <h2 id="gp-patterns">
            Patterns <span className="subtle mono">{patterns.length}</span>
          </h2>
          <div className="row wrap">
            <label className="search-box">
              <Search />
              <input placeholder="Search problems" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search problems" />
            </label>
            <div className="tabs" role="group" aria-label="Difficulty">
              {[['all', 'Any'] as const, ...DIFFS].map(([key, label]) => (
                <button key={key} className={diff === key ? 'active' : ''} aria-pressed={diff === key} onClick={() => setDiff(key)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="tabs" role="group" aria-label="Status">
              {STATUS.map(([key, label]) => (
                <button key={key} className={status === key ? 'active' : ''} aria-pressed={status === key} onClick={() => setStatus(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="patterns">
          {patterns.map((p, i) => {
            const items = (p.items ?? []).filter((i) => test(i, p.title));
            if (filtering && items.length === 0) return null;
            const expanded = filtering || open.has(p.id);
            const finished = p.total > 0 && p.done === p.total;
            return (
              <div key={p.id} className={`pattern${expanded ? ' open' : ''}`}>
                <button className="pattern-h" onClick={() => toggleOpen(p.id)} aria-expanded={expanded}>
                  <span className="pattern-n mono">{i + 1}</span>
                  <span className="pattern-name">
                    {p.title}
                    {p.id === current && <span className="pill">Current</span>}
                    {finished && (
                      <span className="pattern-tick">
                        <Check />
                      </span>
                    )}
                  </span>
                  <span className="pattern-bar">
                    <Bar value={ratio(p.done, p.total)} color={color} size="sm" label={`${p.title} progress`} />
                  </span>
                  <span className="mono subtle pattern-count">
                    {filtering ? `${items.length} shown` : `${p.done}/${p.total}`}
                  </span>
                </button>
                {expanded && (
                  <div className="pattern-body list">
                    <ProblemRows items={items} color={color} onToggle={solve} />
                    {!filtering && (
                      <a className="subtle pattern-more" href={`#/source/${p.id}`}>
                        Open {p.title} on its own page
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filtering && !patterns.some((p) => (p.items ?? []).some((i) => test(i, p.title))) && <p className="empty">No problems match.</p>}
        </div>
      </section>
    </>
  );
}
