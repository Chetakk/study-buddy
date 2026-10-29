import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../lib/api.ts';
import { colorVar, fmtClock } from '../lib/format.ts';
import { ErrorBox, Loading } from '../components/ui.tsx';
import { NoteText } from '../components/NoteText.tsx';
import type { NoteHit } from '../types.ts';

// Every note in one place, grouped by video. Click a time to open the video there.
export function NotesPage() {
  const [q, setQ] = useState('');
  const [notes, setNotes] = useState<NoteHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .get<NoteHit[]>(`/notes?q=${encodeURIComponent(q.trim())}`)
        .then((n) => live && setNotes(n))
        .catch((e: Error) => live && setError(e.message));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  if (error) return <ErrorBox message={error} />;

  const videos: NoteHit[][] = [];
  for (const n of notes ?? []) {
    const last = videos[videos.length - 1];
    if (last?.[0].itemId === n.itemId) last.push(n);
    else videos.push([n]);
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Notes</div>
          <h1>Your notes</h1>
        </div>
      </div>
      <input
        className="input"
        type="search"
        placeholder="Search notes and video titles"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search notes"
      />
      {!notes ? (
        <Loading />
      ) : videos.length === 0 ? (
        <p className="muted">{q ? 'No notes match.' : 'No notes yet. Press N while watching a video to write one.'}</p>
      ) : (
        videos.map((list) => (
          <section key={list[0].itemId} className="card stack notes-video" style={{ gap: 6, '--c': colorVar(list[0].groupColor) } as CSSProperties}>
            <a className="notes-video-h" href={`#/watch/${list[0].itemId}`}>
              <span className="dot" />
              <span>
                <strong>{list[0].itemTitle}</strong>
                <small className="subtle">
                  {' '}
                  · {list[0].groupName} › {list[0].sourceTitle}
                </small>
              </span>
            </a>
            {list.map((n) => (
              <div key={n.id} className="note">
                <a className="time" href={`#/watch/${n.itemId}?t=${Math.floor(n.atS)}`} title="Open the video here">
                  {fmtClock(n.atS)}
                </a>
                <div className="body">
                  <NoteText body={n.body} />
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
