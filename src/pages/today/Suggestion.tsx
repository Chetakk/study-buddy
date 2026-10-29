import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { localDay } from '../../lib/format.ts';

interface Suggestion {
  id: string;
  text: string;
  href: string;
  action: string;
}

// Dismissed suggestions stay hidden for the rest of the day, in this browser.
const KEY = 'sb:dismissed';
function dismissed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v.day === localDay() ? v.ids : [];
  } catch {
    return [];
  }
}

// One quiet line under the greeting: the single most useful nudge right now.
// `skip` drops ones the page already shows (the resume card's video).
export function SuggestionLine({ skip }: { skip: string[] }) {
  const { data } = useLoad(() => api.get<Suggestion[]>('/suggestions'));
  const [hidden, setHidden] = useState(dismissed);
  const s = data?.find((x) => !hidden.includes(x.id) && !skip.includes(x.id));
  if (!s) return null;

  const dismiss = () => {
    const ids = [...hidden, s.id];
    setHidden(ids);
    try {
      localStorage.setItem(KEY, JSON.stringify({ day: localDay(), ids }));
    } catch {}
  };

  return (
    <p className="suggestion" role="status">
      <span>{s.text}</span>
      {s.action && (
        <a href={s.href} className="suggestion-go">
          {s.action} →
        </a>
      )}
      <button className="suggestion-x" onClick={dismiss} aria-label="Dismiss suggestion" title="Dismiss for today">
        ×
      </button>
    </p>
  );
}
