import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { hashParam, navigate } from '../lib/router.ts';
import { colorVar, coveredSeconds, fmtClock, fmtDuration, mergeSegments, pct, ratio } from '../lib/format.ts';
import { isPlayback } from '../../shared/segments.ts';
import { PlayerState, loadYouTube, type YTPlayer } from '../lib/youtube.ts';
import { ErrorBox, GroupDot, Loading, Thumb } from '../components/ui.tsx';
import { NoteText } from '../components/NoteText.tsx';
import { CardForm } from './Cards.tsx';
import { Cards, Check, Expand, Next, Prev, Shrink, Trash } from '../components/icons.tsx';
import type { Card, ItemDetail, Note, Progress, Segment } from '../types.ts';

const FLUSH_EVERY_S = 10;
const AUTO_NEXT_S = 8;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Playback speed is remembered per playlist, in this browser only.
const speedKey = (sourceId: number) => `sb:speed:${sourceId}`;
function savedSpeed(sourceId: number): number {
  try {
    const v = Number(localStorage.getItem(speedKey(sourceId)));
    return SPEEDS.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}
function saveSpeed(sourceId: number, rate: number) {
  try {
    if (rate === 1) localStorage.removeItem(speedKey(sourceId));
    else localStorage.setItem(speedKey(sourceId), String(rate));
  } catch {}
}

export function WatchPage({ id, focus, setFocus }: { id: number; focus: boolean; setFocus: (f: boolean) => void }) {
  const { data: item, error } = useLoad(() => api.get<ItemDetail>(`/items/${id}`), id, false);

  if (error) return <ErrorBox message={error} />;
  if (!item) return <Loading />;
  // Problems and articles have no player; they live on their list's page.
  if (item.kind !== 'video') {
    location.replace(`#/source/${item.sourceId}`);
    return <Loading />;
  }
  return <Watch key={item.id} item={item} focus={focus} setFocus={setFocus} />;
}

function Watch({
  item,
  focus,
  setFocus,
}: {
  item: ItemDetail;
  focus: boolean;
  setFocus: (f: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Tracking state lives in refs so the 1s ticker doesn't re-render through React each time.
  const pending = useRef<Segment[]>([]);
  const playedS = useRef(0);
  const lastT = useRef<number | null>(null);
  const lastWall = useRef(0);
  const sinceFlush = useRef(0);

  const [progress, setProgress] = useState<Progress>(item.progress);
  const [live, setLive] = useState<Segment[]>([]);
  const [now, setNow] = useState(item.progress.positionS);
  const [tab, setTab] = useState<'playlist' | 'notes' | 'cards'>('playlist');
  const [cards, setCards] = useState<Card[]>([]);
  // The card being written: its prefilled text and the video time it's tied to.
  const [draft, setDraft] = useState<{ front?: string; back?: string; atS: number } | null>(null);
  const [notes, setNotes] = useState<Note[]>(item.notes);
  const [toast, setToast] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_NEXT_S);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(() => savedSpeed(item.sourceId));

  const idx = item.playlist.findIndex((p) => p.id === item.id);
  // Previous / next (and auto-play) pass over skipped videos.
  const prev = item.playlist.slice(0, Math.max(idx, 0)).reverse().find((p) => !p.skipped);
  const next = item.playlist.slice(idx + 1).find((p) => !p.skipped);
  const duration = item.durationS;
  const segments = mergeSegments([...progress.segments, ...live]);
  const watched = progress.status === 'done' ? duration : coveredSeconds(segments, duration);

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 2600);
  };

  const payload = () => ({
    segments: pending.current,
    positionS: playerRef.current?.getCurrentTime() ?? now,
    // Lets the server fill in a length it couldn't read when the video was imported.
    durationS: playerRef.current?.getDuration?.() ?? 0,
    playedS: Math.floor(playedS.current),
  });

  const flush = useCallback(async () => {
    if (!pending.current.length && playedS.current < 1) return;
    const body = payload();
    pending.current = [];
    playedS.current -= body.playedS;
    sinceFlush.current = 0;
    try {
      const p = await api.post<Progress>(`/items/${item.id}/progress`, body);
      setProgress((old) => {
        if (old.status !== 'done' && p.status === 'done') showToast('Video done ✓');
        return p;
      });
      setLive([]);
    } catch {
      // Keep the data and retry on the next flush.
      pending.current.unshift(...body.segments);
      playedS.current += body.playedS;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Create the player and the 1s tracking loop.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    // A link with ?t= (from a note) starts there; otherwise pick up where you left off.
    const linked = Number(hashParam('t'));
    const resume = linked > 0 ? Math.floor(linked) : item.progress.positionS < duration - 15 ? Math.floor(item.progress.positionS) : 0;

    loadYouTube()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        const el = document.createElement('div');
        hostRef.current.replaceChildren(el);
        playerRef.current = new YT.Player(el, {
          videoId: item.externalId,
          playerVars: { start: resume, rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: (e) => {
              const rate = savedSpeed(item.sourceId);
              if (rate !== 1) e.target.setPlaybackRate(rate);
            },
            // Also catches speed changes made in YouTube's own settings menu.
            onPlaybackRateChange: (e) => {
              setSpeed(e.data);
              saveSpeed(item.sourceId, e.data);
            },
            onStateChange: (e) => {
              if (e.data === PlayerState.PAUSED) flush();
              if (e.data === PlayerState.ENDED) {
                flush();
                setEnded(true);
                setCountdown(AUTO_NEXT_S);
              }
              if (e.data === PlayerState.PLAYING) setEnded(false);
            },
          },
        });

        timer = window.setInterval(() => {
          const p = playerRef.current;
          if (!p?.getPlayerState) return;
          const t = p.getCurrentTime();
          setNow(t);
          if (p.getPlayerState() !== PlayerState.PLAYING) {
            lastT.current = null;
            return;
          }
          const wall = performance.now();
          if (lastT.current !== null) {
            const dt = t - lastT.current;
            const elapsed = (wall - lastWall.current) / 1000;
            if (isPlayback(dt, elapsed, p.getPlaybackRate())) {
              pending.current.push([lastT.current, t]);
              setLive(mergeSegments(pending.current));
            }
            playedS.current += Math.min(elapsed, 5);
          }
          lastT.current = t;
          lastWall.current = wall;
          if (++sinceFlush.current >= FLUSH_EVERY_S) flush();
        }, 1000);
      })
      .catch((e: Error) => setPlayerError(e.message));

    // Closing the tab: a normal fetch may be cut off, a beacon is not.
    const onHide = () => {
      if (!pending.current.length && playedS.current < 1) return;
      navigator.sendBeacon(`/api/items/${item.id}/progress`, new Blob([JSON.stringify(payload())], { type: 'application/json' }));
      pending.current = [];
      playedS.current = 0;
    };
    window.addEventListener('pagehide', onHide);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('pagehide', onHide);
      flush();
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Countdown to the next video after this one ends.
  useEffect(() => {
    if (!ended || !next) return;
    if (countdown <= 0) {
      navigate(`/watch/${next.id}`);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [ended, countdown, next]);

  const seek = (s: number) => {
    playerRef.current?.seekTo(s, true);
    lastT.current = null;
    setNow(s);
  };

  // Following a note link to the video that's already open just seeks.
  useEffect(() => {
    const onHash = () => {
      const t = Number(hashParam('t'));
      if (t > 0) seek(t);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const toggleDone = async () => {
    await flush();
    const p = await api.post<Progress>(`/items/${item.id}/status`, { done: progress.status !== 'done' });
    setProgress(p);
    if (p.status === 'done') showToast('Marked done ✓');
  };

  const noteAt = useRef(0);
  const startNote = () => {
    noteAt.current = playerRef.current?.getCurrentTime() ?? now;
    setTab('notes');
    setFocus(false);
    setTimeout(() => noteRef.current?.focus(), 0);
  };

  const saveNote = async () => {
    const body = noteRef.current?.value.trim();
    if (!body) return;
    const atS = noteAt.current || now;
    const { id } = await api.post<{ id: number }>(`/items/${item.id}/notes`, { atS, body });
    setNotes((n) => [...n, { id, atS, body, createdAt: new Date().toISOString() }].sort((a, b) => a.atS - b.atS));
    noteRef.current!.value = '';
    noteAt.current = 0;
  };

  // From JARVIS (src/lib/remote.ts): a note at the current time, or "mark it done".
  useEffect(() => {
    const onNote = async (e: Event) => {
      const body = (e as CustomEvent<string>).detail;
      const atS = playerRef.current?.getCurrentTime?.() ?? now;
      const { id } = await api.post<{ id: number }>(`/items/${item.id}/notes`, { atS, body });
      setNotes((n) => [...n, { id, atS, body, createdAt: new Date().toISOString() }].sort((a, b) => a.atS - b.atS));
      showToast('Note added');
    };
    const onDone = () => {
      if (progress.status !== 'done') toggleDone();
    };
    // {do: 'play' | 'pause'} or {do: 'seek', by: ±seconds} or {do: 'speed', to: 1.5}
    const onPlayer = (e: Event) => {
      const c = (e as CustomEvent<{ do: string; by?: number; to?: number }>).detail;
      const p = playerRef.current;
      if (!p?.getPlayerState) return;
      if (c.do === 'play') p.playVideo();
      else if (c.do === 'pause') p.pauseVideo();
      else if (c.do === 'seek') seek(Math.max(0, Math.min(duration, (p.getCurrentTime?.() ?? now) + Number(c.by || 0))));
      else if (c.do === 'speed' && SPEEDS.includes(Number(c.to))) {
        p.setPlaybackRate(Number(c.to));
        showToast(`Speed ${c.to}×`);
      }
    };
    window.addEventListener('sb:note', onNote);
    window.addEventListener('sb:done', onDone);
    window.addEventListener('sb:player', onPlayer);
    return () => {
      window.removeEventListener('sb:note', onNote);
      window.removeEventListener('sb:done', onDone);
      window.removeEventListener('sb:player', onPlayer);
    };
  });

  const [aiReady, setAiReady] = useState(false);
  const [drafting, setDrafting] = useState<'closed' | 'open' | 'busy'>('closed');
  const transcriptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<Card[]>(`/cards?item=${item.id}`).then(setCards, () => {});
    api.get<{ ready: boolean }>('/ai').then((a) => setAiReady(a.ready), () => {});
  }, [item.id]);

  const draftWithAI = async () => {
    setDrafting('busy');
    try {
      const r = await api.post<{ added: number }>(`/items/${item.id}/draft-cards`, { transcript: transcriptRef.current?.value ?? '' });
      showToast(r.added ? `${r.added} draft cards are waiting in Pending review` : 'The AI found nothing to make cards from');
      setDrafting('closed');
    } catch (e) {
      showToast((e as Error).message);
      setDrafting('open');
    }
  };

  const startCard = (init?: { back?: string; atS?: number }) => {
    setDraft({ back: init?.back, atS: init?.atS ?? playerRef.current?.getCurrentTime() ?? now });
    setTab('cards');
    setFocus(false);
  };

  const deleteNote = async (noteId: number) => {
    await api.del(`/notes/${noteId}`);
    setNotes((n) => n.filter((x) => x.id !== noteId));
  };

  const changeSpeed = (step: number) => {
    const p = playerRef.current;
    if (!p?.setPlaybackRate) return;
    const i = SPEEDS.indexOf(p.getPlaybackRate());
    const rate = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + step))];
    p.setPlaybackRate(rate);
    showToast(`Speed ${rate}×`);
  };

  const togglePlay = () => {
    const p = playerRef.current;
    if (!p?.getPlayerState) return;
    if (p.getPlayerState() === PlayerState.PLAYING) p.pauseVideo();
    else p.playVideo();
  };

  // Keyboard: Space/K play, J/L ±10s, < > speed, F focus mode, N new note, Esc leave focus. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = playerRef.current?.getCurrentTime?.() ?? now;
      if (e.key === 'f' || e.key === 'F') setFocus(!focus);
      else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        startNote();
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        startCard();
      } else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        if (el.closest('button, a, [role="slider"]') && e.key === ' ') return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'j' || e.key === 'J') seek(Math.max(0, t - 10));
      else if (e.key === 'l' || e.key === 'L') seek(Math.min(duration, t + 10));
      else if (e.key === '<' || e.key === ',') changeSpeed(-1);
      else if (e.key === '>' || e.key === '.') changeSpeed(1);
      else if (e.key === 'Escape' && focus) setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Keep the current video visible in the playlist panel.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.pl-item.current');
    const box = el?.closest<HTMLElement>('.side-body');
    if (el && box) box.scrollTop = el.offsetTop - box.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
  }, [tab]);

  // Mirror live progress into the cached playlist entry so the side list updates.
  const playlist = item.playlist.map((p) =>
    p.id === item.id ? { ...p, watchedS: watched, status: progress.status } : p,
  );

  const cVar = { '--c': colorVar(item.groupColor) } as CSSProperties;

  return (
    <div className={`watch${focus ? ' focus' : ''}`} style={cVar}>
      <div>
        <div className="player-wrap">
          <div ref={hostRef} />
          {playerError && (
            <div className="end-overlay">
              <p>{playerError}</p>
            </div>
          )}
          {ended && (
            <div className="end-overlay">
              <div className="stack" style={{ gap: 12, alignItems: 'center' }}>
                {next ? (
                  <>
                    <div style={{ opacity: 0.7, fontSize: 13 }}>Up next in {countdown}s</div>
                    <div style={{ fontWeight: 700, fontSize: 18, maxWidth: 520 }}>{next.title}</div>
                    <div className="row">
                      <button className="btn" onClick={() => setEnded(false)}>
                        Stay here
                      </button>
                      <a className="btn btn-primary" href={`#/watch/${next.id}`}>
                        Play now
                      </a>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 20 }}>That was the last video 🎉</div>
                    <a className="btn btn-primary" href={`#/source/${item.sourceId}`}>
                      Back to playlist
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <WatchedStrip segments={segments} duration={duration} now={now} notes={notes} done={progress.status === 'done'} onSeek={seek} />
        <div className="strip-legend">
          <span className="mono">
            {fmtClock(now)} / {fmtClock(duration)}
          </span>
          <span>
            {progress.status === 'done' ? (
              <strong style={{ color: 'var(--text-main)' }}>Done</strong>
            ) : (
              <>
                <span className="mono">{pct(watched, duration)}</span> watched · done at 90%
              </>
            )}
          </span>
        </div>

        <h1 className="watch-title">{item.title}</h1>
        <div className="spread wrap">
          <nav className="crumbs" aria-label="Where this video lives">
            <a href={`#/group/${item.groupId}`}>
              <GroupDot color={item.groupColor} /> {item.groupName}
            </a>
            <span aria-hidden>›</span>
            <a href={`#/source/${item.sourceId}`}>{item.sourceTitle}</a>
          </nav>
          <div className="row" style={{ gap: 6 }}>
            <button className="icon-btn" disabled={!prev} onClick={() => prev && navigate(`/watch/${prev.id}`)} title="Previous video">
              <Prev />
            </button>
            <button className="icon-btn" disabled={!next} onClick={() => next && navigate(`/watch/${next.id}`)} title="Next video">
              <Next />
            </button>
            <button className="icon-btn" onClick={() => setFocus(!focus)} title={focus ? 'Exit focus mode (F)' : 'Focus mode (F)'}>
              {focus ? <Shrink /> : <Expand />}
            </button>
            <button className="btn" onClick={startNote} title="Add a note at the current time (N)">
              Note <kbd>N</kbd>
            </button>
            <button className={`btn${progress.status === 'done' ? '' : ' btn-primary'}`} onClick={toggleDone}>
              <Check /> {progress.status === 'done' ? 'Done' : 'Mark done'}
            </button>
          </div>
        </div>
      </div>

      <aside className="card side" aria-label="Playlist and notes">
        <div className="tabs" role="tablist" style={{ alignSelf: 'flex-start' }}>
          <button role="tab" aria-selected={tab === 'playlist'} className={tab === 'playlist' ? 'active' : ''} onClick={() => setTab('playlist')}>
            Playlist <span className="mono subtle">{idx + 1}/{item.playlist.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>
            Notes <span className="mono subtle">{notes.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'cards'} className={tab === 'cards' ? 'active' : ''} onClick={() => setTab('cards')}>
            Cards <span className="mono subtle">{cards.length}</span>
          </button>
        </div>

        {tab === 'playlist' && (
          <a className="side-pl" href={`#/source/${item.sourceId}`} title="Open the playlist page">
            <span className="side-pl-title">{item.sourceTitle}</span>
            <span className="subtle mono">
              {playlist.filter((p) => p.status === 'done' && !p.skipped).length}/{playlist.filter((p) => !p.skipped).length} done ›
            </span>
          </a>
        )}
        {tab === 'playlist' ? (
          <div className="side-body">
            {playlist.map((p) => (
              <a key={p.id} href={`#/watch/${p.id}`} className={`pl-item${p.id === item.id ? ' current' : ''}${p.skipped ? ' skipped' : ''}`}>
                <span className="idx">{p.status === 'done' ? <span className="done-tick">✓</span> : p.position + 1}</span>
                <Thumb src={p.thumbnail} durationS={p.durationS} watched={ratio(p.watchedS, p.durationS)} color={item.groupColor} />
                <span className="video-title">{p.title}</span>
              </a>
            ))}
          </div>
        ) : tab === 'cards' ? (
          <div className="side-body stack" style={{ gap: 10 }}>
            {draft ? (
              <>
                <div className="subtle" style={{ fontSize: 12 }}>
                  New card at {fmtClock(draft.atS)}
                </div>
                <CardForm
                  key={`${draft.atS}-${draft.back ?? ''}`}
                  fixedGroup
                  initial={draft}
                  onSave={async (body) => {
                    const card = await api.post<Card>('/cards', { ...body, itemId: item.id, atS: draft.atS });
                    setCards((c) => [...c, card].sort((a, b) => (a.atS ?? 0) - (b.atS ?? 0)));
                    setDraft(null);
                    showToast('Card added');
                  }}
                  onClose={() => setDraft(null)}
                />
              </>
            ) : (
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => startCard()}>
                <Cards /> New card at {fmtClock(now)} <kbd>C</kbd>
              </button>
            )}
            {aiReady && !draft && drafting === 'closed' && (
              <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDrafting('open')}>
                Draft cards with AI
              </button>
            )}
            {aiReady && drafting !== 'closed' && (
              <div className="card stack card-form" style={{ gap: 8 }}>
                <label className="field-label" htmlFor="ai-transcript">
                  Transcript (optional)
                </label>
                <textarea
                  id="ai-transcript"
                  ref={transcriptRef}
                  className="textarea"
                  rows={4}
                  placeholder="On YouTube: … under the video → Show transcript, select it all and paste here. Your notes for this video are sent too."
                />
                <div className="row">
                  <button className="btn btn-primary btn-sm" onClick={draftWithAI} disabled={drafting === 'busy'}>
                    {drafting === 'busy' ? 'Drafting…' : 'Draft cards'}
                  </button>
                  <button className="btn btn-sm" onClick={() => setDrafting('closed')} disabled={drafting === 'busy'}>
                    Cancel
                  </button>
                </div>
                <span className="subtle" style={{ fontSize: 12 }}>
                  Drafts go to Flashcards → <a href="#/cards">Pending review</a> for you to approve or edit.
                </span>
              </div>
            )}
            {cards.length === 0 && !draft && (
              <p className="muted" style={{ fontSize: 14 }}>
                No cards for this video yet. Write a question you should be able to answer after watching.
              </p>
            )}
            {cards.map((c) => (
              <div key={c.id} className="note">
                <button className="time" onClick={() => c.atS != null && seek(c.atS)} title="Jump to this moment">
                  {fmtClock(c.atS ?? 0)}
                </button>
                <div className="body">
                  <NoteText body={c.front} />
                  {c.back && (
                    <div className="subtle">
                      <NoteText body={c.back} />
                    </div>
                  )}
                </div>
                <button
                  className="icon-btn"
                  onClick={() => api.del(`/cards/${c.id}`).then(() => setCards((x) => x.filter((y) => y.id !== c.id)))}
                  title="Delete card"
                >
                  <Trash />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="side-body stack" style={{ gap: 10 }}>
            <div>
              <textarea
                ref={noteRef}
                className="textarea"
                placeholder="Write a note… (Enter to save, Shift+Enter for a new line; **bold**, `code`, - lists)"
                onFocus={() => {
                  if (!noteAt.current) noteAt.current = playerRef.current?.getCurrentTime() ?? now;
                }}
                onKeyDown={(e: ReactKeyboardEvent) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveNote();
                  }
                }}
              />
              <div className="subtle" style={{ fontSize: 12, marginTop: 4 }}>
                Saved at the moment you started typing. Click a time to jump there.
              </div>
            </div>
            {notes.length === 0 && <p className="muted" style={{ fontSize: 14 }}>No notes for this video yet.</p>}
            {notes.map((n) => (
              <div key={n.id} className="note">
                <button className="time" onClick={() => seek(n.atS)} title="Jump to this moment">
                  {fmtClock(n.atS)}
                </button>
                <div className="body">
                  <NoteText body={n.body} />
                </div>
                <span className="note-tools">
                  <button className="icon-btn" onClick={() => startCard({ back: n.body, atS: n.atS })} title="Make a card from this note">
                    <Cards />
                  </button>
                  <button className="icon-btn" onClick={() => deleteNote(n.id)} title="Delete note">
                    <Trash />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
          {fmtDuration(duration)} video{speed !== 1 && ` · ${speed}×`} · <kbd>K</kbd> play · <kbd>J</kbd>/<kbd>L</kbd> ±10s ·{' '}
          <kbd>&lt;</kbd>/<kbd>&gt;</kbd> speed · <kbd>F</kbd> focus · <kbd>N</kbd> note · <kbd>C</kbd> card
        </div>
      </aside>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

// Which parts of the video have actually been played. Click anywhere to seek.
function WatchedStrip({
  segments,
  duration,
  now,
  notes,
  done,
  onSeek,
}: {
  segments: Segment[];
  duration: number;
  now: number;
  notes: Note[];
  done: boolean;
  onSeek: (s: number) => void;
}) {
  const at = (s: number) => `${ratio(s, duration) * 100}%`;
  return (
    <div
      className="strip"
      role="slider"
      tabIndex={0}
      aria-label="Watched parts of the video. Click to seek."
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(now)}
      aria-valuetext={fmtClock(now)}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(duration, now + 10));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, now - 10));
      }}
    >
      {done && segments.length === 0 ? (
        <span className="seg" style={{ left: 0, width: '100%', opacity: 0.5 }} />
      ) : (
        segments.map(([a, b]) => <span key={a} className="seg" style={{ left: at(a), width: `calc(${at(b - a)} + 1px)` }} />)
      )}
      {notes.map((n) => (
        <span key={n.id} className="note-mark" style={{ left: at(n.atS) }} title={`Note at ${fmtClock(n.atS)}`} />
      ))}
      <span className="head" style={{ left: at(now) }} />
    </div>
  );
}
