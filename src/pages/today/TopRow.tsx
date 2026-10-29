import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { dueText } from '../Cards.tsx';
import { fmtClock, fmtDuration, pct, ratio, unitOf } from '../../lib/format.ts';
import { Cards, Play, Plus } from '../../components/icons.tsx';
import type { CardSummary, ResumeItem, Today } from '../../types.ts';
import { cVar, minutes } from './shared.ts';

export function ResumeCard({ r, onChange }: { r: ResumeItem | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  if (!r) {
    return (
      <section className="card resume resume-empty" aria-label="Continue watching">
        <h2>You're all caught up</h2>
        <p className="muted">Every video in your groups is done. Add another playlist to keep going.</p>
        <div>
          <a className="btn btn-primary" href="#/library">
            <Plus /> Add a playlist
          </a>
        </div>
      </section>
    );
  }

  const started = r.status === 'in_progress' && r.positionS > 0;
  const left = Math.max(0, r.durationS - r.positionS);
  const at = (s: number) => `${ratio(s, r.durationS) * 100}%`;

  const markDone = async () => {
    setBusy(true);
    try {
      await api.post(`/items/${r.id}/status`, { done: true });
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card resume" aria-label="Continue watching" style={cVar(r.groupColor)}>
      <a className="vthumb" href={`#/watch/${r.id}`} aria-label={`${started ? 'Resume' : 'Play'} ${r.title}`}>
        {r.thumbnail && <img src={r.thumbnail} alt="" />}
        <span className="play">
          <Play />
        </span>
        {r.durationS > 0 && <span className="dur">{fmtClock(r.durationS)}</span>}
        {r.watchedS > 0 && (
          <span className="w">
            <span style={{ width: `${ratio(r.watchedS, r.durationS) * 100}%` }} />
          </span>
        )}
      </a>
      <div className="r-body">
        <div className="kicker">
          <span className="dot" />
          {r.groupName} · {r.sourceTitle} · {r.position + 1} of {r.sourceTotal}
        </div>
        <h2 className="r-title">{r.title}</h2>
        <div>
          <div className="strip strip-sm" aria-label={`${pct(r.watchedS, r.durationS)} watched`}>
            {r.segments.map(([a, b], i) => (
              <span key={i} className="seg" style={{ left: at(a), width: `calc(${at(b)} - ${at(a)})` }} />
            ))}
            {started && <span className="head" style={{ left: at(r.positionS) }} />}
          </div>
          <div className="r-meta">
            <span className="mono">
              {fmtClock(r.positionS)} / {fmtClock(r.durationS)}
            </span>
            <span>
              <b>{fmtDuration(left)} left</b> · {pct(r.watchedS, r.durationS)} watched
            </span>
          </div>
        </div>
        <div className="r-actions">
          <a className="btn btn-primary" href={`#/watch/${r.id}`}>
            <Play />
            {started ? `Resume at ${fmtClock(r.positionS)}` : 'Start watching'}
          </a>
          <button className="btn" onClick={markDone} disabled={busy}>
            Mark done
          </button>
        </div>
        {r.next && (
          <a className="then" href={`#/watch/${r.next.id}`}>
            <span className="then-l">Then</span>
            <span className="vthumb">{r.next.thumbnail && <img src={r.next.thumbnail} alt="" loading="lazy" />}</span>
            <strong>{r.next.title}</strong>
          </a>
        )}
      </div>
    </section>
  );
}

export function TodayCard({ data }: { data: Today }) {
  const done = data.groups.reduce((a, g) => a + g.done, 0);
  const total = data.groups.reduce((a, g) => a + g.total, 0);
  const diff = data.studiedTodayS - data.avgDailyS;

  let studiedNote = 'Nothing yet today';
  if (data.studiedTodayS >= 60) {
    studiedNote = !data.avgDailyS
      ? 'Good start'
      : Math.abs(diff) < 60
        ? 'Right on your daily average'
        : `${minutes(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than your daily average`;
  }

  return (
    <section className="card panel" aria-labelledby="today-h">
      <h2 id="today-h">Today</h2>
      <div className="tstat">
        <span>Studied</span>
        <b>{minutes(data.studiedTodayS)}</b>
        <small>{studiedNote}</small>
      </div>
      <div className="tstat">
        <span>Streak</span>
        <b>
          {data.streak} {data.streak === 1 ? 'day' : 'days'}
        </b>
        <small>Longest: {data.longestStreak} {data.longestStreak === 1 ? 'day' : 'days'}</small>
      </div>
      <div className="tstat">
        <span>Today's groups</span>
        <b>{pct(done, total)}</b>
        <small>
          {done} of {total} {unitOf(data.groups.flatMap((g) => g.sources.map((s) => s.kind)))}
        </small>
      </div>
    </section>
  );
}

export function FlashcardsCard() {
  const { data: s } = useLoad(() => api.get<CardSummary>('/cards/summary'));
  const piles: [string, number | undefined][] = [
    ['Due', s?.due],
    ['Learning', s ? s.piles.learning + s.piles.struggling : undefined],
    ['Mastered', s?.piles.mastered],
  ];
  return (
    <section className="card panel" aria-labelledby="fc-h">
      <div className="panel-h">
        <span className="panel-icon">
          <Cards />
        </span>
        <h2 id="fc-h">
          <a href="#/cards" className="plain-link">
            Flashcards
          </a>
        </h2>
        {s && s.reviewedToday > 0 && <span className="pill">{s.reviewedToday} today</span>}
      </div>
      {!s ? (
        <p className="muted">…</p>
      ) : s.total === 0 ? (
        <p className="muted">Make cards from notes while you watch (press C), or solve a problem to have it come back for review.</p>
      ) : s.due ? (
        <a className="btn btn-primary" href="#/review">
          <Play /> Review {s.due} {s.due === 1 ? 'card' : 'cards'}
        </a>
      ) : (
        <p className="muted">All caught up. {dueText(s)}.</p>
      )}
      <div className="piles">
        {piles.map(([p, n]) => (
          <div key={p}>
            <span>{p}</span>
            <b className={p === 'Due' && n ? 'on' : ''}>{n ?? '–'}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
