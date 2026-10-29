import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { notifyChanged, useOnChanged } from '../lib/events.ts';
import { colorVar, fmtClock } from '../lib/format.ts';
import { ErrorBox, Loading } from '../components/ui.tsx';
import { NoteText } from '../components/NoteText.tsx';
import { Check, Pencil, Play, Plus, Trash } from '../components/icons.tsx';
import type { Card, CardSummary, Group, Pile } from '../types.ts';

const PILES: [Pile | 'all', string][] = [
  ['pending', 'Pending review'],
  ['all', 'All'],
  ['new', 'New'],
  ['learning', 'Learning'],
  ['review', 'Review'],
  ['mastered', 'Mastered'],
  ['struggling', 'Struggling'],
];

export function dueText(s: CardSummary): string {
  if (s.due) return `${s.due} due now`;
  if (!s.nextDue) return s.total ? 'Nothing due' : 'No cards yet';
  const d = new Date(s.nextDue);
  const today = new Date().toDateString() === d.toDateString();
  return `Next ${today ? `at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

export function CardsPage() {
  const [pile, setPile] = useState<Pile | 'all'>('all');
  const [q, setQ] = useState('');
  const [cards, setCards] = useState<Card[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sum = useLoad(() => api.get<CardSummary>('/cards/summary'));
  const groups = useLoad(() => api.get<Group[]>('/groups'));

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (pile !== 'all') params.set('pile', pile);
    if (q.trim()) params.set('q', q.trim());
    api
      .get<Card[]>(`/cards?${params}`)
      .then(setCards)
      .catch((e: Error) => setError(e.message));
  }, [pile, q]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const changed = useCallback(() => {
    load();
    sum.reload();
  }, [load, sum.reload]);
  useOnChanged(changed);

  if (error || sum.error) return <ErrorBox message={(error ?? sum.error)!} />;
  const s = sum.data;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Flashcards</div>
          <h1>Your cards</h1>
          {s && (
            <p className="muted" style={{ marginTop: 4 }}>
              {s.total} {s.total === 1 ? 'card' : 'cards'} · {dueText(s)}
              {s.reviewedToday > 0 && ` · ${s.reviewedToday} reviewed today`}
            </p>
          )}
        </div>
        <div className="row">
          <button className="btn" onClick={() => setAdding(!adding)} aria-expanded={adding}>
            <Plus /> New card
          </button>
          <a className={`btn${s?.due ? ' btn-primary' : ''}`} href="#/review" aria-disabled={!s?.due}>
            <Play /> Review{s?.due ? ` ${s.due}` : ''}
          </a>
        </div>
      </div>

      {adding && groups.data && (
        <CardForm
          groups={groups.data}
          onSave={async (body) => {
            await api.post('/cards', body);
            notifyChanged();
          }}
          onClose={() => setAdding(false)}
        />
      )}

      <div className="spread wrap">
        <div className="tabs" role="tablist" aria-label="Piles">
          {PILES.filter(([key]) => key !== 'pending' || s?.piles.pending || pile === 'pending').map(([key, label]) => (
            <button key={key} role="tab" aria-selected={pile === key} className={pile === key ? 'active' : ''} onClick={() => setPile(key)}>
              {label} {s && <span className="mono subtle">{key === 'all' ? s.total - s.piles.pending : s.piles[key]}</span>}
            </button>
          ))}
        </div>
        {pile === 'pending' && cards && cards.length > 1 && (
          <button
            className="btn btn-sm"
            onClick={() => Promise.all(cards.map((c) => api.patch(`/cards/${c.id}`, { pending: false }))).then(() => notifyChanged())}
          >
            <Check /> Approve all {cards.length}
          </button>
        )}
        <input className="input cards-search" type="search" placeholder="Search cards" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search cards" />
      </div>

      {!cards ? (
        <Loading />
      ) : cards.length === 0 ? (
        <div className="card empty">
          <h2>{q || pile !== 'all' ? 'No cards here' : 'No cards yet'}</h2>
          <p>
            Make a card with <b>New card</b>, from a note while watching (<kbd>C</kbd>), or by solving a problem: it comes back to be solved again.
          </p>
        </div>
      ) : (
        <div className="card list">
          {cards.filter((c) => pile !== 'all' || c.pile !== 'pending').map((c) => (
            <CardRow key={c.id} card={c} groups={groups.data ?? []} onChange={() => notifyChanged()} />
          ))}
        </div>
      )}
    </div>
  );
}

const PILE_LABEL: Record<Pile, string> = { pending: 'Draft', new: 'New', learning: 'Learning', review: 'Review', mastered: 'Mastered', struggling: 'Struggling' };

function CardRow({ card: c, groups, onChange }: { card: Card; groups: Group[]; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <CardForm
        groups={groups}
        card={c}
        onSave={async (body) => {
          await api.patch(`/cards/${c.id}`, body);
          onChange();
        }}
        onClose={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="list-row card-row" style={{ '--c': colorVar(c.groupColor) } as CSSProperties}>
      <span className="dot" title={c.groupName} />
      <div className="video-meta">
        <div className="video-title">{c.kind === 'problem' ? `Solve again: ${c.front}` : <NoteText body={c.front} />}</div>
        {c.back && (
          <div className="video-sub card-back">
            <NoteText body={c.back} />
          </div>
        )}
        <div className="video-sub">
          <span className={`chip pile-${c.pile}`}>{PILE_LABEL[c.pile]}</span>{' '}
          {c.origin === 'ai' && c.pile === 'pending' && 'Drafted by AI · '}
          {c.reps > 0 && <>due {new Date(c.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · </>}
          {c.itemId && c.itemKind === 'video' ? (
            <a href={`#/watch/${c.itemId}${c.atS != null ? `?t=${Math.floor(c.atS)}` : ''}`}>
              {c.itemTitle}
              {c.atS != null && ` at ${fmtClock(c.atS)}`}
            </a>
          ) : c.sourceId ? (
            <a href={`#/source/${c.sourceId}`}>{c.sourceTitle}</a>
          ) : (
            c.groupName
          )}
        </div>
      </div>
      <span className="row-actions">
        {c.pile === 'pending' && (
          <button className="btn btn-sm" onClick={() => api.patch(`/cards/${c.id}`, { pending: false }).then(onChange)} title="Keep this card">
            <Check /> Approve
          </button>
        )}
        {c.kind !== 'problem' && (
          <button className="icon-btn" onClick={() => setEditing(true)} title="Edit card" aria-label="Edit card">
            <Pencil />
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => confirm('Delete this card?') && api.del(`/cards/${c.id}`).then(onChange)}
          title="Delete card"
          aria-label="Delete card"
        >
          <Trash />
        </button>
      </span>
    </div>
  );
}

// Front and back, and a group when the card isn't tied to a video.
export function CardForm({
  groups,
  card,
  initial,
  fixedGroup,
  onSave,
  onClose,
}: {
  groups?: Group[];
  card?: Card;
  initial?: { front?: string; back?: string };
  fixedGroup?: boolean;
  onSave: (body: { front: string; back: string; groupId?: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [front, setFront] = useState(card?.front ?? initial?.front ?? '');
  const [back, setBack] = useState(card?.back ?? initial?.back ?? '');
  const [groupId, setGroupId] = useState<number>(card?.groupId ?? groups?.[0]?.id ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!front.trim()) return;
    setBusy(true);
    try {
      await onSave({ front, back, ...(fixedGroup || card?.itemId ? {} : { groupId }) });
      if (card) onClose();
      else {
        setFront('');
        setBack('');
        setError(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card stack card-form"
      style={{ gap: 10 }}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        if (e.key === 'Escape') onClose();
      }}
    >
      <div>
        <label className="field-label" htmlFor={`cf-front-${card?.id ?? 'new'}`}>
          Front: the question
        </label>
        <textarea id={`cf-front-${card?.id ?? 'new'}`} className="textarea" value={front} onChange={(e) => setFront(e.target.value)} autoFocus rows={2} />
      </div>
      <div>
        <label className="field-label" htmlFor={`cf-back-${card?.id ?? 'new'}`}>
          Back: the answer
        </label>
        <textarea id={`cf-back-${card?.id ?? 'new'}`} className="textarea" value={back} onChange={(e) => setBack(e.target.value)} rows={3} />
      </div>
      {!fixedGroup && !card?.itemId && groups && (
        <div>
          <label className="field-label" htmlFor={`cf-group-${card?.id ?? 'new'}`}>
            Group
          </label>
          <select id={`cf-group-${card?.id ?? 'new'}`} className="select" value={groupId} onChange={(e) => setGroupId(Number(e.target.value))}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={busy || !front.trim()}>
          {card ? 'Save' : 'Add card'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {card ? 'Cancel' : 'Close'}
        </button>
        <span className="subtle" style={{ fontSize: 12 }}>
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save
        </span>
      </div>
    </form>
  );
}
