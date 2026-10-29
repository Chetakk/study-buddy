import { useState, type CSSProperties, type MouseEvent } from 'react';
import { api } from '../lib/api.ts';
import { useLoad } from '../lib/useLoad.ts';
import { colorVar, fmtDuration, pct, ratio, unitOf } from '../lib/format.ts';
import { Bar, ErrorBox, GroupDot, Loading } from '../components/ui.tsx';
import type { Stats } from '../types.ts';

const WEEKS = 52;

function dayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 0 = nothing, then 15m / 45m / 1h30 / more.
function level(s: number) {
  if (s <= 0) return 0;
  if (s < 15 * 60) return 1;
  if (s < 45 * 60) return 2;
  if (s < 90 * 60) return 3;
  return 4;
}

interface Tip {
  x: number;
  y: number;
  text: string;
}

export function ProgressPage() {
  const { data, error } = useLoad(() => api.get<Stats>('/stats'));
  const [tip, setTip] = useState<Tip | null>(null);
  const [view, setView] = useState<'chart' | 'table'>('chart');

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  const showTip = (e: MouseEvent, text: string) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, text });
  };

  const total = data.groups.reduce((a, g) => a + g.total, 0);
  const done = data.groups.reduce((a, g) => a + g.done, 0);
  const durationS = data.groups.reduce((a, g) => a + g.durationS, 0);
  const watchedS = data.groups.reduce((a, g) => a + g.watchedS, 0);

  // Heatmap: columns are weeks (Mon first), ending with the current week.
  const byDay = new Map(data.days.map((d) => [d.day, d.seconds]));
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const cells = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    return { key, date: d, seconds: byDay.get(key) ?? 0, future: d > today };
  });

  // Last 7 days, stacked by group.
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 6 + i);
    return d;
  });
  const weekRows = days.map((d) => {
    const key = dayKey(d);
    const parts = data.groups
      .map((g) => ({ g, s: data.week.find((w) => w.day === key && w.groupId === g.id)?.seconds ?? 0 }))
      .filter((p) => p.s > 0);
    return { d, key, parts, sum: parts.reduce((a, p) => a + p.s, 0) };
  });
  const weekMax = Math.max(...weekRows.map((r) => r.sum), 1);
  const weekTotal = weekRows.reduce((a, r) => a + r.sum, 0);
  const activeGroups = data.groups.filter((g) => weekRows.some((r) => r.parts.some((p) => p.g.id === g.id)));

  return (
    <div className="stack" onMouseLeave={() => setTip(null)}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Progress</div>
          <h1>How far you've come</h1>
        </div>
      </div>

      <div className="stats-row">
        <div className="card stat" style={{ flex: '1 1 200px' }}>
          <div className="stat-label">All groups</div>
          <div className="big-pct" style={{ margin: '6px 0 10px' }}>
            {pct(done, total)}
          </div>
          <Bar value={ratio(done, total)} label="Overall progress" />
          <div className="subtle" style={{ fontSize: 12, marginTop: 6 }}>
            {done} of {total} {unitOf(data.groups.flatMap((g) => g.sources.map((s) => s.kind)))}
          </div>
        </div>
        <div className="card stat" style={{ flex: '1 1 160px' }}>
          <div className="stat-label">Content covered</div>
          <div className="value">{fmtDuration(watchedS)}</div>
          <div className="subtle" style={{ fontSize: 12 }}>of {fmtDuration(durationS)}</div>
        </div>
        <div className="card stat" style={{ flex: '1 1 160px' }}>
          <div className="stat-label">Time studied</div>
          <div className="value">{fmtDuration(data.totalStudiedS)}</div>
          <div className="subtle" style={{ fontSize: 12 }}>{fmtDuration(weekTotal)} in the last 7 days</div>
        </div>
        <div className="card stat" style={{ flex: '1 1 160px' }}>
          <div className="stat-label">Streak</div>
          <div className="value">{data.streak} {data.streak === 1 ? 'day' : 'days'}</div>
          <div className="subtle" style={{ fontSize: 12 }}>days with 1 min or more</div>
        </div>
      </div>

      <section className="card stack" style={{ gap: 14 }}>
        <div className="spread wrap">
          <h2>Study days</h2>
          <div className="heat-legend" aria-hidden>
            Less
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className="cell" style={{ background: `var(--seq-${l})` }} />
            ))}
            More
          </div>
        </div>
        <div className="heatmap" role="img" aria-label={`Study time per day over the last ${WEEKS} weeks`}>
          {cells.map((c) => (
            <span
              key={c.key}
              className={`cell${c.future ? ' future' : ''}`}
              data-l={level(c.seconds)}
              onMouseEnter={(e) =>
                showTip(
                  e,
                  `${c.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${
                    c.seconds ? fmtDuration(c.seconds) : 'no study'
                  }`,
                )
              }
              onMouseLeave={() => setTip(null)}
            />
          ))}
        </div>
      </section>

      <section className="card stack" style={{ gap: 12 }}>
        <div className="spread wrap">
          <h2>Last 7 days</h2>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={view === 'chart'} className={view === 'chart' ? 'active' : ''} onClick={() => setView('chart')}>
              Chart
            </button>
            <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}>
              Table
            </button>
          </div>
        </div>
        {activeGroups.length > 0 && (
          <div className="legend">
            {activeGroups.map((g) => (
              <span key={g.id}>
                <GroupDot color={g.color} /> {g.name}
              </span>
            ))}
          </div>
        )}
        {view === 'chart' ? (
          <div>
            <div className="week">
              {weekRows.map((r) => (
                <div
                  key={r.key}
                  className="week-col"
                  onMouseEnter={(e) =>
                    showTip(
                      e,
                      r.sum
                        ? `${fmtDuration(r.sum)}: ${r.parts.map((p) => `${p.g.name} ${fmtDuration(p.s)}`).join(', ')}`
                        : 'No study',
                    )
                  }
                  onMouseLeave={() => setTip(null)}
                >
                  {r.parts.map((p) => (
                    <span
                      key={p.g.id}
                      className="seg"
                      style={{ '--c': colorVar(p.g.color), height: `${(p.s / weekMax) * 100}%` } as CSSProperties}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="week-labels">
              {weekRows.map((r) => (
                <span key={r.key}>{r.d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              ))}
            </div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr className="subtle" style={{ textAlign: 'left' }}>
                <th style={{ padding: 6 }}>Day</th>
                {data.groups.map((g) => (
                  <th key={g.id} style={{ padding: 6 }}>{g.name}</th>
                ))}
                <th style={{ padding: 6 }}>Total</th>
              </tr>
            </thead>
            <tbody className="mono">
              {weekRows.map((r) => (
                <tr key={r.key} style={{ borderTop: '1px solid var(--glass-border)' }}>
                  <td style={{ padding: 6, fontFamily: 'var(--font)' }}>{r.d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</td>
                  {data.groups.map((g) => {
                    const s = r.parts.find((p) => p.g.id === g.id)?.s ?? 0;
                    return <td key={g.id} style={{ padding: 6 }}>{s ? fmtDuration(s) : '–'}</td>;
                  })}
                  <td style={{ padding: 6 }}>{r.sum ? fmtDuration(r.sum) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid grid-2">
        {data.groups.map((g) => (
          <section key={g.id} className="card stack" style={{ gap: 12 }}>
            <div className="group-head">
              <GroupDot color={g.color} />
              <h2>{g.name}</h2>
              <span className="big-pct" style={{ fontSize: 26 }}>{pct(g.done, g.total)}</span>
            </div>
            <Bar value={ratio(g.done, g.total)} color={g.color} size="lg" label={`${g.name} progress`} />
            <div className="subtle" style={{ fontSize: 13 }}>
              {g.done}/{g.total} {unitOf(g.sources.map((s) => s.kind))}
              {g.durationS > 0 && ` · ${fmtDuration(g.watchedS)} of ${fmtDuration(g.durationS)} covered`}
            </div>
            {g.sources.map((s) => (
              <a key={s.id} href={`#/source/${s.id}`} className="source-row">
                <span className="source-title">{s.title}</span>
                <span className="mono subtle" style={{ fontSize: 12 }}>{pct(s.done, s.total)}</span>
                <Bar value={ratio(s.done, s.total)} color={g.color} size="sm" label={`${s.title} progress`} />
              </a>
            ))}
          </section>
        ))}
      </div>

      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.text}
        </div>
      )}
    </div>
  );
}
