import { useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { notifyChanged } from '../lib/events.ts';
import { GROUP_COLORS, colorVar, fmtDuration, nextColor, ratio, unitOf } from '../lib/format.ts';
import { Bar, ErrorBox, GroupDot, Loading } from '../components/ui.tsx';
import { Down, Pencil, Plus, Refresh, Trash, Up } from '../components/icons.tsx';
import type { Group } from '../types.ts';

export function LibraryPage() {
  const { data: groups, error, reload } = useLoad(() => api.get<Group[]>('/groups'));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  if (error) return <ErrorBox message={error} />;
  if (!groups) return <Loading />;

  const run = async (label: string, fn: () => Promise<unknown>, done?: (r: any) => string) => {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      if (done) setMsg({ text: done(r) });
      reload();
      notifyChanged();
    } catch (e) {
      setMsg({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  const move = (index: number, delta: number) => {
    const ids = groups.map((g) => g.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    run('order', () => api.post('/groups/order', { ids }));
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Library</div>
          <h1>Your study groups</h1>
        </div>
      </div>

      <div className="grid grid-2">
        <AddPlaylist groups={groups} busy={busy === 'import'} onAdd={(groupId, url) =>
          /docs\.google\.com\/spreadsheets/.test(url)
            ? run('import', () => api.post('/sheets', { groupId, url }), (r) =>
                `Imported ${r.total} problems in ${r.sections} patterns${r.added < r.total ? ` (${r.added} new)` : ''}`,
              )
            : run('import', () => api.post('/sources', { groupId, url }), (r) => `Added "${r.title}" (${r.count} videos)`)
        } />
        <NewGroup
          onCreate={(name) =>
            run('group', () => api.post('/groups', { name, color: nextColor(groups.map((g) => g.color)) }))
          }
        />
      </div>
      {msg && (
        <p className={msg.error ? 'error' : 'muted'} role="status">
          {msg.text}
        </p>
      )}

      {groups.map((g, i) => (
        <GroupCard
          key={g.id}
          group={g}
          groups={groups}
          first={i === 0}
          last={i === groups.length - 1}
          onMove={(d) => move(i, d)}
          run={run}
        />
      ))}

      <YourData run={run} busy={busy} />
    </div>
  );
}

// Export downloads everything as one JSON file; import replaces all data with such a file.
function YourData({ run, busy }: { run: (label: string, fn: () => Promise<unknown>, done?: (r: any) => string) => void; busy: string | null }) {
  const download = async () => {
    const data = await api.get('/export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `study-buddy-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const upload = (file: File | undefined) => {
    if (!file || !confirm('Replace all your data with this file? A backup of the current data is saved first.')) return;
    run('import-data', async () => api.post('/import', JSON.parse(await file.text())), () => 'Data imported');
  };
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <h2>Your data</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        A backup is saved every day (the last 7 are kept next to the database). Export a file to keep a copy elsewhere.
      </p>
      <div className="row">
        <button className="btn" onClick={() => run('export', download)} disabled={busy === 'export'}>
          Export
        </button>
        <label className="btn">
          {busy === 'import-data' ? 'Importing…' : 'Import'}
          <input type="file" accept="application/json,.json" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
    </div>
  );
}

function AddPlaylist({ groups, busy, onAdd }: { groups: Group[]; busy: boolean; onAdd: (groupId: number, url: string) => void }) {
  const [url, setUrl] = useState('');
  const [groupId, setGroupId] = useState<number | ''>('');
  const target = groupId || groups[0]?.id;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (target && url.trim()) {
      onAdd(target, url.trim());
      setUrl('');
    }
  };

  return (
    <form className="card stack" style={{ gap: 12 }} onSubmit={submit}>
      <h2>Add a YouTube playlist</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Adding a lot? The Study Buddy Chrome extension imports your saved playlists in one go (see the README).
      </p>
      <div>
        <label className="field-label" htmlFor="pl-url">
          YouTube playlist or problem sheet
        </label>
        <input
          id="pl-url"
          className="input"
          placeholder="youtube.com/playlist?list=… or a Google Sheets link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <div className="row">
        <div style={{ flex: 1 }}>
          <label className="field-label" htmlFor="pl-group">
            Into group
          </label>
          <select
            id="pl-group"
            className="select"
            value={target ?? ''}
            onChange={(e) => setGroupId(Number(e.target.value))}
            disabled={!groups.length}
          >
            {groups.length === 0 && <option value="">Create a group first</option>}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }} disabled={busy || !target || !url.trim()}>
          {busy ? 'Importing…' : 'Add'}
        </button>
      </div>
    </form>
  );
}

function NewGroup({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <form
      className="card stack"
      style={{ gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) {
          onCreate(name.trim());
          setName('');
        }
      }}
    >
      <h2>New group</h2>
      <p className="muted" style={{ fontSize: 14 }}>
        A group is anything you study daily: a subject like ML, or a single course. It can hold several playlists.
      </p>
      <div className="row">
        <input className="input" placeholder="e.g. Python" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
        <button className="btn" disabled={!name.trim()}>
          <Plus /> Create
        </button>
      </div>
    </form>
  );
}

function GroupCard({
  group: g,
  groups,
  first,
  last,
  onMove,
  run,
}: {
  group: Group;
  groups: Group[];
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  run: (label: string, fn: () => Promise<unknown>, done?: (r: any) => string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(g.name);

  return (
    <section className="card stack" style={{ gap: 14 }} aria-label={g.name}>
      <div className="spread wrap">
        {editing ? (
          <form
            className="row"
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              run('rename', () => api.patch(`/groups/${g.id}`, { name }));
              setEditing(false);
            }}
          >
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Group name" />
            <button className="btn btn-primary btn-sm">Save</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="row" style={{ minWidth: 0 }}>
            <GroupDot color={g.color} />
            <h2>
              <a href={`#/group/${g.id}`} className="h-link">
                {g.name}
              </a>
            </h2>
            <span className="muted mono" style={{ fontSize: 13 }}>
              {g.done}/{g.total}
            </span>
          </div>
        )}
        <div className="row" style={{ gap: 2 }}>
          <div className="swatches" role="radiogroup" aria-label={`${g.name} colour`} style={{ marginRight: 8 }}>
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${g.color === c ? ' active' : ''}`}
                style={{ background: colorVar(c), width: 18, height: 18 }}
                role="radio"
                aria-checked={g.color === c}
                aria-label={c}
                onClick={() => run('color', () => api.patch(`/groups/${g.id}`, { color: c }))}
              />
            ))}
          </div>
          <button className="icon-btn" onClick={() => setEditing(true)} title="Rename">
            <Pencil />
          </button>
          <button className="icon-btn" onClick={() => onMove(-1)} disabled={first} title="Move up">
            <Up />
          </button>
          <button className="icon-btn" onClick={() => onMove(1)} disabled={last} title="Move down">
            <Down />
          </button>
          <button
            className="icon-btn btn-danger"
            title="Delete group"
            onClick={() => {
              if (confirm(`Delete "${g.name}" and all its playlists and progress? This can't be undone.`)) {
                run('delete', () => api.del(`/groups/${g.id}`));
              }
            }}
          >
            <Trash />
          </button>
        </div>
      </div>

      {g.sources.length === 0 ? (
        <p className="muted" style={{ fontSize: 14 }}>
          No playlists yet. Add one above.
        </p>
      ) : (
        g.sources.map((s) => (
          <div key={s.id} className="card-subtle stack" style={{ gap: 10 }}>
            <div className="spread wrap">
              <a href={`#/source/${s.id}`} style={{ minWidth: 0, flex: 1 }}>
                <div className="source-title" style={{ fontSize: 15 }}>
                  {s.title}
                </div>
                <div className="subtle" style={{ fontSize: 12 }}>
                  {s.channel && `${s.channel} · `}
                  {s.total} {unitOf([s.kind], s.total)}
                  {s.durationS > 0 && ` · ${fmtDuration(s.durationS)}`}
                </div>
              </a>
              <div className="row" style={{ gap: 2 }}>
                {groups.length > 1 && (
                  <select
                    className="select"
                    style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
                    value={g.id}
                    aria-label="Move to group"
                    onChange={(e) => run('move', () => api.patch(`/sources/${s.id}`, { groupId: Number(e.target.value) }))}
                  >
                    {groups.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.id === g.id ? `In ${o.name}` : `Move to ${o.name}`}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="icon-btn"
                  title={s.kind === 'problem_set' ? 'Check the sheet for new problems' : 'Check YouTube for new videos'}
                  onClick={() =>
                    run('sync', () => api.post(`/sources/${s.id}/sync`), (r) =>
                      r.added
                        ? `${r.added} new ${s.kind === 'problem_set' ? 'problems' : 'videos'} added`
                        : `"${s.title}" is up to date`,
                    )
                  }
                >
                  <Refresh />
                </button>
                <button
                  className="icon-btn btn-danger"
                  title={s.kind === 'problem_set' ? 'Remove pattern' : 'Remove playlist'}
                  onClick={() => {
                    if (confirm(`Remove "${s.title}" and its progress? This can't be undone.`)) {
                      run('remove', () => api.del(`/sources/${s.id}`));
                    }
                  }}
                >
                  <Trash />
                </button>
              </div>
            </div>
            <Bar value={ratio(s.done, s.total)} color={g.color} size="sm" label={`${s.title} progress`} />
          </div>
        ))
      )}
    </section>
  );
}
