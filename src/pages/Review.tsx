import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api.ts';
import { hashParam } from '../lib/router.ts';
import { notifyChanged } from '../lib/events.ts';
import { colorVar, fmtClock } from '../lib/format.ts';
import { ErrorBox, Loading } from '../components/ui.tsx';
import { NoteText } from '../components/NoteText.tsx';
import { External, Play } from '../components/icons.tsx';
import type { QueueCard } from '../types.ts';

const RATINGS = [
  [1, 'Again'],
  [2, 'Hard'],
  [3, 'Good'],
  [4, 'Easy'],
] as const;

// "10m", "4d", "3mo"
export function fmtInterval(ms: number): string {
  const m = Math.round(ms / 60e3);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d`;
  const mo = Math.round(d / 30);
  return mo < 12 ? `${mo}mo` : `${Math.round((d / 365) * 10) / 10}y`;
}

// One card at a time: try to recall, reveal with Space, rate with 1–4.
export function ReviewPage() {
  const group = Number(hashParam('group')) || 0;
  const [cards, setCards] = useState<QueueCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<QueueCard[]>(`/cards/queue${group ? `?group=${group}` : ''}`)
      .then(setCards)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const card = cards?.[0];

  const rate = async (rating: number) => {
    if (!card || busy) return;
    setBusy(true);
    try {
      await api.post(`/cards/${card.id}/review`, { rating });
      setDone((n) => n + 1);
      setShown(false);
      // Cards rated Again or Hard come back later in this session, so refetch rather than just dropping it.
      const rest = cards!.slice(1);
      if (rating <= 2 || rest.length === 0) await load();
      else setCards(rest);
      notifyChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key));
      else if (shown && e.key === ' ') {
        e.preventDefault();
        rate(3);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <ErrorBox message={error} />;
  if (!cards) return <Loading />;

  if (!card) {
    return (
      <div className="card empty review-done">
        <h2>{done ? `Done: ${done} ${done === 1 ? 'card' : 'cards'} reviewed` : 'Nothing to review right now'}</h2>
        <p>Cards come back when they're due. Make new ones from notes on the Watch page.</p>
        <p className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          <a className="btn" href="#/cards">
            All cards
          </a>
          <a className="btn btn-primary" href="#/">
            Back to Today
          </a>
        </p>
      </div>
    );
  }

  const video = card.itemId && card.itemKind === 'video';
  const problemUrl = card.kind === 'problem' ? card.itemUrl : null;

  return (
    <div className="review" style={{ '--c': colorVar(card.groupColor) } as CSSProperties}>
      <div className="spread review-top">
        <span className="subtle mono">
          {done} done · {cards.length} left
        </span>
        <a className="btn btn-sm" href="#/cards">
          End
        </a>
      </div>

      <article className="card review-card">
        <div className="kicker">
          <span className="dot" />
          {card.groupName}
          {card.kind === 'problem' ? ` · ${card.sourceTitle ?? 'Problem'}` : card.itemTitle ? ` · ${card.itemTitle}` : ''}
          <span className="pill">{card.pile === 'new' ? 'New' : card.kind === 'problem' ? 'Solve again' : card.pile}</span>
        </div>

        <div className="review-front">
          {card.kind === 'problem' ? (
            <>
              <p className="subtle">Solve this again without looking at your old answer:</p>
              <h2>{card.front}</h2>
              {card.problem?.difficulty && <span className={`diff-chip diff-${card.problem.difficulty}`}>{card.problem.difficulty}</span>}
            </>
          ) : (
            <h2>
              <NoteText body={card.front} />
            </h2>
          )}
        </div>

        {!shown ? (
          <div className="review-actions">
            {problemUrl && (
              <a className="btn" href={problemUrl} target="_blank" rel="noreferrer">
                <External /> Open problem
              </a>
            )}
            <button className="btn btn-primary" onClick={() => setShown(true)}>
              {card.kind === 'problem' ? 'I tried it' : 'Show answer'} <kbd>Space</kbd>
            </button>
          </div>
        ) : (
          <>
            <div className="review-back">
              {card.kind === 'problem' ? (
                <p className="muted">
                  {card.problem?.concept && (
                    <>
                      Pattern: <b>{card.problem.concept}</b>.{' '}
                    </>
                  )}
                  How did it go?
                  {card.problem?.links.map((l) => (
                    <a key={l.url} className="prob-link" href={l.url} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                      {l.label}
                    </a>
                  ))}
                </p>
              ) : card.back ? (
                <NoteText body={card.back} />
              ) : (
                <p className="subtle">No answer written on this card.</p>
              )}
              {video && (
                <a className="btn btn-sm" href={`#/watch/${card.itemId}${card.atS != null ? `?t=${Math.floor(card.atS)}` : ''}`}>
                  <Play /> Watch{card.atS != null && ` at ${fmtClock(card.atS)}`}
                </a>
              )}
            </div>
            <div className="ratings" role="group" aria-label="How well did you remember?">
              {RATINGS.map(([n, label]) => (
                <button key={n} className={`btn rate rate-${n}`} onClick={() => rate(n)} disabled={busy}>
                  <span>
                    {label} <kbd>{n}</kbd>
                  </span>
                  <small className="mono">{fmtInterval(card.intervals[n])}</small>
                </button>
              ))}
            </div>
          </>
        )}
      </article>
    </div>
  );
}
