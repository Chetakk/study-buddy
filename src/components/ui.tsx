import { Component, type CSSProperties, type ReactNode } from 'react';
import { colorVar, fmtDuration, pct, ratio } from '../lib/format.ts';
import { Check } from './icons.tsx';
import type { Status } from '../types.ts';

export function Bar({ value, color, size, label }: { value: number; color?: string; size?: 'sm' | 'lg'; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className={`bar${size ? ` bar-${size}` : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      style={color ? ({ '--c': colorVar(color) } as CSSProperties) : undefined}
    >
      <span style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function GroupDot({ color }: { color: string }) {
  return <span className="dot" style={{ background: colorVar(color) }} aria-hidden />;
}

export function Thumb({
  src,
  durationS,
  watched,
  color,
}: {
  src: string;
  durationS: number;
  watched?: number;
  color?: string;
}) {
  return (
    <div className="thumb" style={color ? ({ '--c': colorVar(color) } as CSSProperties) : undefined}>
      {src && <img src={src} alt="" loading="lazy" />}
      {durationS > 0 && <span className="dur">{fmtDuration(durationS).replace(/ 00m$/, 'h')}</span>}
      {watched !== undefined && watched > 0 && (
        <div className="watched">
          <span style={{ width: `${ratio(watched, 1) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function DoneToggle({
  status,
  color,
  onToggle,
  title,
}: {
  status: Status;
  color?: string;
  onToggle: () => void;
  title: string;
}) {
  const on = status === 'done';
  return (
    <button
      className={`check${on ? ' on' : ''}`}
      style={color ? ({ '--c': colorVar(color) } as CSSProperties) : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={on}
      title={on ? `Mark "${title}" as not done` : `Mark "${title}" as done`}
    >
      <Check />
    </button>
  );
}

export function Loading() {
  return <div className="empty muted">Loading…</div>;
}

export function ErrorBox({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="card empty">
      <p className="error">{message}</p>
      {children}
    </div>
  );
}

const RING = 2 * Math.PI * 24;

// Progress ring with the percentage (or a tick when complete) in the middle.
export function Ring({ done, total, color, size = 56 }: { done: number; total: number; color: string; size?: number }) {
  const r = ratio(done, total);
  return (
    <div
      className="ring"
      role="img"
      aria-label={`${pct(done, total)} done`}
      style={{ '--c': colorVar(color), width: size, height: size } as CSSProperties}
    >
      <svg viewBox="0 0 56 56">
        <circle className="ring-bg" cx="28" cy="28" r="24" />
        <circle className="ring-fg" cx="28" cy="28" r="24" style={{ '--len': RING, '--off': RING * (1 - r) } as CSSProperties} />
      </svg>
      {total > 0 && done === total ? (
        <span className="ring-tick">
          <Check />
        </span>
      ) : (
        <b>{pct(done, total)}</b>
      )}
    </div>
  );
}

// Keeps a crash in one page from blanking the whole app: the sidebar stays and the error is shown.
export class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ErrorBox message={`This page hit an error: ${this.state.error.message}`}>
        <p className="muted" style={{ marginTop: 8 }}>
          If you just updated Study Buddy, restart the server, then reload.
        </p>
        <p style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </p>
      </ErrorBox>
    );
  }
}
