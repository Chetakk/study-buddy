import type { CSSProperties } from 'react';
import { colorVar } from '../lib/format.ts';
import { Check } from '../components/icons.tsx';
import { LANES, ROADMAP, STAGES, type RoadItem } from './roadmap-data.ts';

// Swim lanes (rows) by stage (columns): read left to right to see what is done, what is happening and what comes next.
export function RoadmapPage() {
  const done = ROADMAP.filter((r) => r.stage === 'done').length;
  const upNext = ROADMAP.filter((r) => r.stage === 'now');

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="eyebrow">Roadmap</div>
          <h1>What is next</h1>
        </div>
        <span className="muted">
          {done} of {ROADMAP.length} built
        </span>
      </div>

      <div className="road-track" role="img" aria-label={`${done} of ${ROADMAP.length} built`}>
        {STAGES.map(([stage, label]) => {
          const n = ROADMAP.filter((r) => r.stage === stage).length;
          return <div key={stage} className={`road-seg ${stage}`} style={{ flexGrow: n }} title={`${label}: ${n}`} />;
        })}
      </div>

      <section className="card stack road-now" style={{ gap: 8 }}>
        <div className="eyebrow" style={{ margin: 0 }}>In progress</div>
        {upNext.map((r) => (
          <div key={r.title} className="road-now-row" style={{ '--c': colorVar(laneColor(r)) } as CSSProperties}>
            <span className="dot" />
            <b>{r.title}</b>
            <span className="muted">{r.note}</span>
          </div>
        ))}
      </section>

      <div className="road-scroll">
        <div className="road-grid">
          <div />
          {STAGES.map(([stage, label]) => (
            <div key={stage} className={`road-col ${stage}`}>
              {label}
            </div>
          ))}
          {LANES.map(([lane, name, color]) => (
            <Lane key={lane} name={name} color={color} items={ROADMAP.filter((r) => r.lane === lane)} />
          ))}
        </div>
      </div>
    </div>
  );
}

const laneColor = (r: RoadItem) => LANES.find(([l]) => l === r.lane)![2];

function Lane({ name, color, items }: { name: string; color: string; items: RoadItem[] }) {
  return (
    <>
      <div className="road-lane" style={{ '--c': colorVar(color) } as CSSProperties}>
        <span className="dot" />
        {name}
      </div>
      {STAGES.map(([stage]) => (
        <div key={stage} className="road-cell" style={{ '--c': colorVar(color) } as CSSProperties}>
          {items
            .filter((r) => r.stage === stage)
            .map((r) => (
              <div key={r.title} className={`road-node ${stage}${r.hold ? ' hold' : ''}`}>
                <div className="road-title">
                  {stage === 'done' && <Check />}
                  {r.title}
                </div>
                <div className="road-note">{r.note}</div>
                {r.after && <div className="road-after">after {r.after}</div>}
                {r.hold && <div className="road-after">on hold</div>}
              </div>
            ))}
        </div>
      ))}
    </>
  );
}
