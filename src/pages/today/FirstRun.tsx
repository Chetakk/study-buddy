import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api.ts';
import { nextColor } from '../../lib/format.ts';

export function FirstRun({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the group exists, so a failed import can be retried without making a second group.
  const [groupId, setGroupId] = useState<number | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    let id = groupId;
    try {
      if (id === null) {
        id = (await api.post<{ id: number }>('/groups', { name: name.trim(), color: nextColor([]) })).id;
        setGroupId(id);
      }
      if (url.trim()) await api.post('/sources', { groupId: id, url: url.trim() });
      onDone();
    } catch (err) {
      const msg = (err as Error).message;
      setError(id === null ? msg : `The group was created, but the playlist couldn't be imported: ${msg}`);
      setBusy(false);
    }
  };

  return (
    <section className="card first-run" aria-labelledby="first-h">
      <div>
        <h2 id="first-h">Set up your first group</h2>
        <p className="muted">A group holds the playlists for one subject, like ML, Python or LeetCode.</p>
      </div>
      <ol>
        <li>Name a group</li>
        <li>Paste a YouTube playlist link</li>
        <li>Press play. Only the parts you actually watch count.</li>
      </ol>
      <form onSubmit={submit} className="first-form">
        <div>
          <label className="field-label" htmlFor="fr-name">
            Group name
          </label>
          <input id="fr-name" className="input" placeholder="e.g. Machine Learning" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="fr-url">
            Playlist link <span className="subtle">(optional)</span>
          </label>
          <input
            id="fr-url"
            className="input"
            placeholder="https://www.youtube.com/playlist?list=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? (url.trim() ? 'Importing playlist…' : 'Creating…') : groupId ? 'Try again' : 'Create group'}
          </button>
          {groupId !== null && !busy && (
            <button type="button" className="btn" onClick={onDone}>
              Skip for now
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
