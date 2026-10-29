import type { ReactNode } from 'react';

// A small, safe subset of Markdown for notes: **bold**, *italic*, `code`, links, and "- " bullet lines.
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>;
    return (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    );
  });
}

export function NoteText({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) bullets.push(m[1]);
    else {
      flush();
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="note-text">{blocks}</div>;
}
