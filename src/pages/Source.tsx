import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { fmtDuration, pct, ratio, timeLeft } from '../lib/format.ts';
import { notifyChanged } from '../lib/events.ts';
import { Bar, DoneToggle, ErrorBox, GroupDot, Loading, Thumb } from '../components/ui.tsx';
import { External, Eye, Play } from '../components/icons.tsx';
import type { ListItem, Progress, SourceDetail, Status } from '../types.ts';

const FILTERS: [string, string, (i: ListItem) => boolean][] = [
  ['all', 'All', () => true],
  ['left', 'Left', (i) => i.status !== 'done' && !i.skipped],
  ['started', 'In progress', (i) => i.status === 'in_progress' && !i.skipped],
  ['done', 'Done', (i) => i.status === 'done'],
  ['skipped', 'Skipped', (i) => i.skipped],
];

export function SourcePage({ id }: { id: number }) {
  const { data: src, error, reload } = useLoad(() => api.get<SourceDetail>(`/sources/${id}`), id);
  const [filter, setFilter] = useState('all');

  if (error) return <ErrorBox message={error} />;
  if (!src) return <Loading />;

  const toggle = async (itemId: number, status: Status) => {
    await api.post<Progress>(`/items/${itemId}/status`, { done: status !== 'done' });
    reload();
    notifyChanged();
  };

  const skip = async (itemId: number, skipped: boolean) => {
    await api.post(`/items/${itemId}/skip`, { skipped });
    reload();
    notifyChanged();
  };

  const problems = src.kind === 'problem_set';
  const anySkipped = src.items.some((i) => i.skipped);
  const filters = FILTERS.filter((f) => !(problems && f[0] === 'started') && (f[0] !== 'skipped' || anySkipped));
  const label = (key: string, text: string) => (problems ? ({ left: 'To solve', done: 'Solved' } as Record<string, string>)[key] ?? text : text);
  const test = filters.find((f) => f[0] === filter)?.[2] ?? (() => true);
  const items = src.items.filter(test);
  const live = src.items.filter((i) => !i.skipped);
  const next = live.find((i) => i.status === 'in_progress') ?? live.find((i) => i.status !== 'done');

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <nav className="crumbs eyebrow-crumbs" aria-label="Breadcrumb">
            <a href={`#/group/${src.group.id}`}>
              <GroupDot color={src.group.color} /> {src.group.name}
            </a>
            <span aria-hidden>›</span>
            <span>{src.kind === 'problem_set' ? 'Pattern' : 'Playlist'}</span>
          </nav>
          <h1>{src.title}</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            {src.channel && `${src.channel} · `}
            {problems ? `${src.total} problems` : `${src.total} videos · ${fmtDuration(src.durationS)}`}
          </p>
        </div>
        <div className="row">
          <a className="btn" href={src.url} target="_blank" rel="noreferrer">
            <External /> {problems ? 'Open sheet' : 'YouTube'}
          </a>
          {problems && next && (
            <a className="btn btn-primary" href={next.url || '#'} target="_blank" rel="noreferrer">
              <Play /> Next problem
            </a>
          )}
          {!problems && next && (
            <a className="btn btn-primary" href={`#/watch/${next.id}`}>
              <Play /> {next.status === 'in_progress' ? 'Continue' : 'Start'}
            </a>
          )}
        </div>
      </div>

      <div className="card stack" style={{ gap: 10 }}>
        <div className="spread">
          <span className="big-pct">{pct(src.done, src.total)}</span>
          <span className="muted mono" style={{ fontSize: 14 }}>
            {problems
              ? `${src.done}/${src.total} solved`
              : `${src.done}/${src.total} videos · ${fmtDuration(src.watchedS)} of ${fmtDuration(src.durationS)}`}
          </span>
        </div>
        <Bar value={ratio(src.done, src.total)} color={src.group.color} size="lg" label={problems ? 'Problems solved' : 'Playlist progress'} />
        {!problems && src.done < src.total && timeLeft(src.durationS - src.watchedS, src.paceS) && (
          <span className="subtle" style={{ fontSize: 13 }}>
            {timeLeft(src.durationS - src.watchedS, src.paceS)}
          </span>
        )}
      </div>

      <div className="card">
        <div className="spread wrap" style={{ marginBottom: 10 }}>
          <div className="tabs" role="tablist">
            {filters.map(([key, text, t]) => (
              <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
                {label(key, text)} <span className="mono subtle">{src.items.filter(t).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="list">
          {items.length === 0 && <p className="empty">Nothing here.</p>}
          {problems && <ProblemRows items={items} color={src.group.color} onToggle={toggle} />}
          {!problems && items.map((i) => (
            <a key={i.id} href={`#/watch/${i.id}`} className={`list-row${i.skipped ? ' skipped' : ''}`}>
              <span className="idx">{i.position + 1}</span>
              <Thumb src={i.thumbnail} durationS={i.durationS} watched={ratio(i.watchedS, i.durationS)} color={src.group.color} />
              <div className="video-meta">
                <div className="video-title">{i.title}</div>
                <div className="video-sub">
                  {fmtDuration(i.durationS)}
                  {i.skipped ? ' · Skipped, not counted' : i.status === 'in_progress' && ` · ${pct(i.watchedS, i.durationS)} watched`}
                  {!i.skipped && i.rewatchedAt && ` · Rewatched ${shortDate(i.rewatchedAt)}`}
                </div>
              </div>
              <span className="row-actions">
                <button
                  className="icon-btn skip-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    skip(i.id, !i.skipped);
                  }}
                  title={i.skipped ? 'Count this video again' : "Skip: don't count this video"}
                  aria-label={i.skipped ? `Count "${i.title}" again` : `Skip "${i.title}"`}
                  aria-pressed={i.skipped}
                >
                  <Eye off={!i.skipped} />
                </button>
                {!i.skipped && <DoneToggle status={i.status} color={src.group.color} title={i.title} onToggle={() => toggle(i.id, i.status)} />}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// SQLite's datetime('now') is UTC without a zone marker.
const shortDate = (sqlUtc: string) => new Date(`${sqlUtc.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const DIFF: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// Problems grouped under the sheet's sub-concepts (e.g. Traversal, Path Sum), each linking out to solve it.
export function ProblemRows({ items, color, onToggle }: { items: ListItem[]; color: string; onToggle: (id: number, s: Status) => void }) {
  let concept = '';
  return (
    <>
      {items.map((i) => {
        const m = i.meta;
        const heading = m.concept && m.concept !== concept ? m.concept : '';
        if (m.concept) concept = m.concept;
        return (
          <div key={i.id}>
            {heading && <div className="concept-h">{heading}</div>}
            <div className={`list-row prob-row${i.status === 'done' ? ' solved' : ''}`}>
              <span className="idx">{i.position + 1}</span>
              <div className="video-meta">
                {i.url ? (
                  <a className="video-title prob-title" href={i.url} target="_blank" rel="noreferrer">
                    {i.title}
                  </a>
                ) : (
                  <div className="video-title">{i.title}</div>
                )}
                <div className="prob-tags">
                  {m.difficulty && <span className={`diff-chip diff-${m.difficulty}`}>{DIFF[m.difficulty]}</span>}
                  {m.challenge && <span className="chip">Challenge</span>}
                  {m.homework && <span className="chip">Homework</span>}
                  {!i.url && <span className="subtle">No link in the sheet</span>}
                  {m.links?.map((l) => (
                    <a key={l.url} className="prob-link" href={l.url} target="_blank" rel="noreferrer">
                      {l.label}
                    </a>
                  ))}
                </div>
              </div>
              <DoneToggle status={i.status} color={color} title={i.title} onToggle={() => onToggle(i.id, i.status)} />
            </div>
          </div>
        );
      })}
    </>
  );
}
