import { useRef, useState, type FormEvent } from 'react';
import { api } from '../../lib/api.ts';
import { notifyChanged } from '../../lib/events.ts';
import { useDismiss } from '../../lib/useDismiss.ts';
import { GROUP_COLORS, colorVar, fmtClock, nextColor, ratio, unitOf } from '../../lib/format.ts';
import { Ring } from '../../components/ui.tsx';
import { Check, Dots, Eye, Grip, Pencil, Plus, Trash } from '../../components/icons.tsx';
import type { Today, TodayGroup } from '../../types.ts';
import { cVar } from './shared.ts';

export function Groups({
  groups,
  all,
  setGroups,
  onChange,
}: {
  groups: TodayGroup[];
  all: Today['allGroups'];
  setGroups: (g: TodayGroup[]) => void;
  onChange: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const saveOrder = (list: TodayGroup[]) =>
    api.post('/groups/order', { ids: list.map((g) => g.id) }).then(notifyChanged, onChange);

  const move = (id: number, to: number) => {
    const list = groups.filter((g) => g.id !== id);
    list.splice(Math.max(0, Math.min(to, list.length)), 0, groups.find((g) => g.id === id)!);
    setGroups(list);
    return list;
  };

  const patch = (id: number, body: object) => api.patch(`/groups/${id}`, body).then(onChange, onChange);

  return (
    <section className="groups" aria-labelledby="groups-h">
      <div className="groups-h">
        <h2 id="groups-h">Today's groups</h2>
        <span className="subtle groups-hint">In order: do the first one first</span>
        <div className="choose-wrap">
          <button className="btn btn-sm" onClick={() => setChoosing(!choosing)} aria-expanded={choosing} aria-haspopup="dialog">
            Choose groups <span className="mono subtle">{groups.length}/{all.length}</span>
          </button>
          {choosing && <GroupChooser all={all} onClose={() => setChoosing(false)} onChange={onChange} />}
        </div>
      </div>
      {groups.length === 0 && (
        <p className="muted">No groups on Today. Use <b>Choose groups</b> to pick what you're studying right now.</p>
      )}
      <div className="tiles">
        {groups.map((g, i) => (
          <GroupTile
            key={g.id}
            g={g}
            dragging={dragging === g.id}
            menuOpen={menu === g.id}
            renaming={renaming === g.id}
            onMenu={(open) => setMenu(open ? g.id : null)}
            onRename={(name) => {
              setRenaming(null);
              if (name && name !== g.name) {
                setGroups(groups.map((x) => (x.id === g.id ? { ...x, name } : x)));
                patch(g.id, { name });
              }
            }}
            onStartRename={() => {
              setMenu(null);
              setRenaming(g.id);
            }}
            onColor={(color) => {
              setGroups(groups.map((x) => (x.id === g.id ? { ...x, color } : x)));
              patch(g.id, { color });
            }}
            onDelete={() => {
              setMenu(null);
              setGroups(groups.filter((x) => x.id !== g.id));
              api.del(`/groups/${g.id}`).then(onChange, onChange);
            }}
            canMove={[i > 0, i < groups.length - 1]}
            onMove={(delta) => {
              setMenu(null);
              saveOrder(move(g.id, i + delta));
            }}
            onDragStart={() => setDragging(g.id)}
            onDragOver={(after) => {
              if (dragging === null || dragging === g.id) return;
              const without = groups.filter((x) => x.id !== dragging);
              const target = without.findIndex((x) => x.id === g.id) + (after ? 1 : 0);
              if (groups.findIndex((x) => x.id === dragging) !== target) move(dragging, target);
            }}
            onDragEnd={() => {
              setDragging(null);
              saveOrder(groups);
            }}
            onSolved={(itemId) => api.post(`/items/${itemId}/status`, { done: true }).then(onChange, onChange)}
            onHide={() => {
              setMenu(null);
              setGroups(groups.filter((x) => x.id !== g.id));
              patch(g.id, { onToday: false });
            }}
            onGoal={(goalMin) => {
              setGroups(groups.map((x) => (x.id === g.id ? { ...x, goalMin } : x)));
              patch(g.id, { goalMin });
            }}
          />
        ))}
        <NewGroupTile used={groups.map((g) => g.color)} onCreated={onChange} />
      </div>
    </section>
  );
}

function GroupTile({
  g,
  dragging,
  menuOpen,
  renaming,
  onMenu,
  onRename,
  onStartRename,
  onColor,
  onDelete,
  canMove,
  onMove,
  onDragStart,
  onDragOver,
  onDragEnd,
  onSolved,
  onHide,
  onGoal,
}: {
  g: TodayGroup;
  dragging: boolean;
  menuOpen: boolean;
  renaming: boolean;
  onMenu: (open: boolean) => void;
  onRename: (name: string) => void;
  onStartRename: () => void;
  onColor: (color: string) => void;
  onDelete: () => void;
  canMove: [boolean, boolean];
  onMove: (delta: number) => void;
  onDragStart: () => void;
  onDragOver: (after: boolean) => void;
  onDragEnd: () => void;
  onSolved: (itemId: number) => void;
  onHide: () => void;
  onGoal: (goalMin: number) => void;
}) {
  const [draggable, setDraggable] = useState(false);
  const finished = g.total > 0 && g.done === g.total;
  const next = g.upNext[0];

  return (
    <article
      className={`card tile${dragging ? ' dragging' : ''}${menuOpen ? ' menu-open' : ''}`}
      style={cVar(g.color)}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(g.id));
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        onDragOver(e.clientX - box.left > box.width / 2);
      }}
      onDragEnd={() => {
        setDraggable(false);
        onDragEnd();
      }}
    >
      <span className="tile-glow" aria-hidden />
      <div className="tools">
        <button
          className="icon-btn grip"
          aria-label={`Drag to reorder ${g.name}`}
          title="Drag to reorder"
          onPointerDown={() => setDraggable(true)}
          onPointerUp={() => setDraggable(false)}
        >
          <Grip />
        </button>
        <button
          className="icon-btn"
          aria-label={`${g.name} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => onMenu(!menuOpen)}
        >
          <Dots />
        </button>
        {menuOpen && (
          <TileMenu
            color={g.color}
            name={g.name}
            canMove={canMove}
            onClose={() => onMenu(false)}
            onRename={onStartRename}
            onColor={onColor}
            onMove={onMove}
            onHide={onHide}
            onDelete={onDelete}
            goalMin={g.goalMin}
            onGoal={onGoal}
          />
        )}
      </div>

      <a className="tile-top" href={`#/group/${g.id}`} onClick={(e) => renaming && e.preventDefault()}>
        <Ring done={g.done} total={g.total} color={g.color} />
        <div className="tile-info">
          {renaming ? (
            <RenameInput name={g.name} onDone={onRename} />
          ) : (
            <h3 title={g.name}>{g.name}</h3>
          )}
          <p>
            {g.done} of {g.total} {unitOf(g.sources.map((s) => s.kind), g.total)}
            {g.studiedToday && !finished && !g.goalMin && (
              <span className="today-tick">
                <Check /> Studied today
              </span>
            )}
          </p>
          {g.goalMin > 0 && !finished && <GoalLine todayS={g.todayS} goalMin={g.goalMin} />}
        </div>
      </a>

      {g.sources.length === 0 ? (
        <p className="tile-note">
          No playlists yet. <a href="#/library">Add one</a>
        </p>
      ) : finished ? (
        <p className="tile-note">
          {g.finishedAt
            ? `Finished on ${new Date(g.finishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.`
            : 'Finished.'}
        </p>
      ) : next?.kind === 'problem' ? (
        <div className="next next-problem">
          <a
            className="next-link"
            href={next.url || `#/source/${next.sourceId}`}
            target={next.url ? '_blank' : undefined}
            rel="noreferrer"
            title={next.url ? 'Open the problem' : undefined}
          >
            <span className={`pbadge diff-${next.meta.difficulty || 'none'}`}>{(next.meta.difficulty || '?')[0].toUpperCase()}</span>
            <span className="next-t">
              <span className="next-title">{next.title}</span>
              <small>
                Up next · {next.sourceTitle}
                {next.meta.difficulty && ` · ${next.meta.difficulty[0].toUpperCase()}${next.meta.difficulty.slice(1)}`}
              </small>
            </span>
          </a>
          <button className="icon-btn solve" onClick={() => onSolved(next.id)} title="Mark as solved" aria-label={`Mark ${next.title} as solved`}>
            <Check />
          </button>
        </div>
      ) : next ? (
        <a className="next" href={`#/watch/${next.id}`}>
          <span className="vthumb">
            {next.thumbnail && <img src={next.thumbnail} alt="" loading="lazy" />}
            {next.durationS > 0 && <span className="dur">{fmtClock(next.durationS)}</span>}
            {next.watchedS > 0 && (
              <span className="w">
                <span style={{ width: `${ratio(next.watchedS, next.durationS) * 100}%` }} />
              </span>
            )}
          </span>
          <span className="next-t">
            <span className="next-title">{next.title}</span>
            <small>{next.status === 'in_progress' ? <b>Resume at {fmtClock(next.positionS)}</b> : 'Up next'}</small>
          </span>
        </a>
      ) : null}
    </article>
  );
}

// Today's minutes against the group's daily goal. Overall completion stays on the ring.
function GoalLine({ todayS, goalMin }: { todayS: number; goalMin: number }) {
  const mins = Math.floor(todayS / 60);
  const met = mins >= goalMin;
  return (
    <div className={`goal${met ? ' met' : ''}`} title="Today's study time against your daily goal">
      <span className="goal-bar">
        <span style={{ width: `${Math.min(1, mins / goalMin) * 100}%` }} />
      </span>
      <small>{met ? <><Check /> Goal met · {mins} min</> : `${mins} of ${goalMin} min today`}</small>
    </div>
  );
}

const GOALS = [0, 15, 30, 45, 60, 90, 120];

function RenameInput({ name, onDone }: { name: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v.trim());
  };
  return (
    <input
      className="rename"
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value);
        else if (e.key === 'Escape') finish(name);
      }}
      aria-label="Group name"
    />
  );
}

function TileMenu({
  color,
  name,
  canMove,
  onClose,
  onRename,
  onColor,
  onMove,
  onHide,
  onDelete,
  goalMin,
  onGoal,
}: {
  goalMin: number;
  onGoal: (goalMin: number) => void;
  color: string;
  name: string;
  canMove: [boolean, boolean];
  onClose: () => void;
  onRename: () => void;
  onColor: (c: string) => void;
  onMove: (delta: number) => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);

  useDismiss(ref, onClose);

  return (
    <div className="menu" role="menu" ref={ref}>
      {confirm ? (
        <div className="confirm">
          <p>
            Delete <b>{name}</b> with its playlists and watch progress? This can't be undone.
          </p>
          <div className="row">
            <button className="btn btn-sm btn-danger-solid" onClick={onDelete}>
              Delete
            </button>
            <button className="btn btn-sm" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button className="mi" role="menuitem" onClick={onRename}>
            <Pencil /> Rename
          </button>
          <div className="mi-swatches" role="radiogroup" aria-label="Colour">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${c === color ? ' active' : ''}`}
                style={{ background: colorVar(c) }}
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                onClick={() => onColor(c)}
              />
            ))}
          </div>
          <label className="mi mi-goal">
            Daily goal
            <select className="select" value={GOALS.includes(goalMin) ? goalMin : 0} onChange={(e) => onGoal(Number(e.target.value))} aria-label="Daily goal">
              {GOALS.map((m) => (
                <option key={m} value={m}>
                  {m ? `${m} min` : 'None'}
                </option>
              ))}
            </select>
          </label>
          {(canMove[0] || canMove[1]) && <hr />}
          {canMove[0] && (
            <button className="mi" role="menuitem" onClick={() => onMove(-1)}>
              Move earlier
            </button>
          )}
          {canMove[1] && (
            <button className="mi" role="menuitem" onClick={() => onMove(1)}>
              Move later
            </button>
          )}
          <hr />
          <button className="mi" role="menuitem" onClick={onHide}>
            <Eye off /> Remove from Today
          </button>
          <button className="mi danger" role="menuitem" onClick={() => setConfirm(true)}>
            <Trash /> Delete group
          </button>
        </>
      )}
    </div>
  );
}

// Pick which groups the Today page shows. Changes save as you tick.
function GroupChooser({ all, onClose, onChange }: { all: Today['allGroups']; onClose: () => void; onChange: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(() => new Set(all.filter((g) => g.onToday).map((g) => g.id)));

  useDismiss(ref, onClose);

  const toggle = (id: number) => {
    const next = new Set(on);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOn(next);
    api.patch(`/groups/${id}`, { onToday: next.has(id) }).then(onChange, onChange);
  };

  return (
    <div className="menu chooser" role="dialog" aria-label="Groups on Today" ref={ref}>
      <p className="subtle chooser-note">Show on Today</p>
      {all.map((g) => (
        <label key={g.id} className="mi chooser-row" style={cVar(g.color)}>
          <input type="checkbox" checked={on.has(g.id)} onChange={() => toggle(g.id)} />
          <span className="dot" />
          <span className="chooser-name">{g.name}</span>
          <a href={`#/group/${g.id}`} className="subtle chooser-open" onClick={onClose}>
            Open
          </a>
        </label>
      ))}
    </div>
  );
}

function NewGroupTile({ used, onCreated }: { used: string[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post('/groups', { name: name.trim(), color: nextColor(used) });
      setName('');
      setOpen(false);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!open) {
    return (
      <button className="tile tile-new" onClick={() => setOpen(true)}>
        <Plus />
        New group
      </button>
    );
  }
  return (
    <form className="tile tile-new open" onSubmit={submit}>
      <label className="field-label" htmlFor="new-group">
        New group
      </label>
      <input
        id="new-group"
        className="input"
        placeholder="e.g. System Design"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        autoFocus
      />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn btn-primary btn-sm" disabled={!name.trim()}>
          Create
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
