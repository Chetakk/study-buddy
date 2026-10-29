import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { api } from '../lib/api.ts';
import { colorVar } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { Search as SearchIcon } from './icons.tsx';
import type { SearchHit } from '../types.ts';

// Ctrl/Cmd+K palette: type to jump to a group, playlist or video.
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const last = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => last?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .get<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`)
        .then((h) => {
          if (!live) return;
          setHits(h);
          setSel(0);
        })
        .catch(() => live && setHits([]));
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const open = (h: SearchHit) => {
    onClose();
    navigate(h.href.slice(1));
  };

  const onKey = (e: KeyboardEvent) => {
    const n = hits?.length ?? 0;
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      setSel((sel + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      setSel((sel - 1 + n) % n);
    } else if (e.key === 'Enter' && hits?.[sel]) {
      e.preventDefault();
      open(hits[sel]);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
        <div className="palette-in">
          <SearchIcon />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search videos, playlists and groups"
            aria-label="Search"
            aria-controls="search-results"
            aria-activedescendant={hits?.length ? `hit-${sel}` : undefined}
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="results" id="search-results" role="listbox">
          {hits === null ? null : hits.length === 0 ? (
            <div className="res-empty">{q ? `Nothing matches “${q}”.` : 'Add a group in Library to get started.'}</div>
          ) : (
            hits.map((h, i) => (
              <a
                key={h.href + i}
                id={`hit-${i}`}
                href={h.href}
                role="option"
                aria-selected={i === sel}
                className={`res${i === sel ? ' on' : ''}`}
                style={{ '--c': colorVar(h.color) } as CSSProperties}
                onMouseMove={() => i !== sel && setSel(i)}
                onClick={(e) => {
                  e.preventDefault();
                  open(h);
                }}
              >
                <span className="dot" />
                <span className="res-l">
                  {h.title}
                  {h.sub && <small>{h.sub}</small>}
                </span>
                <span className="res-k">{h.kind}</span>
              </a>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
        </div>
      </div>
    </div>
  );
}
