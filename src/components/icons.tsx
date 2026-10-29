// Small inline icon set (Lucide-style strokes) so the app needs no icon package.
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const Check = () => (
  <svg {...base}><path d="M20 6 9 17l-5-5" /></svg>
);
export const Play = () => (
  <svg {...base}><path d="m6 4 14 8-14 8z" /></svg>
);
export const Sun = () => (
  <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
);
export const Moon = () => (
  <svg {...base}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const Plus = () => (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
);
export const Trash = () => (
  <svg {...base}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
);
export const Refresh = () => (
  <svg {...base}><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg>
);
export const Up = () => (
  <svg {...base}><path d="m18 15-6-6-6 6" /></svg>
);
export const Down = () => (
  <svg {...base}><path d="m6 9 6 6 6-6" /></svg>
);
export const Prev = () => (
  <svg {...base}><path d="M19 20 9 12l10-8zM5 19V5" /></svg>
);
export const Next = () => (
  <svg {...base}><path d="m5 4 10 8-10 8zM19 5v14" /></svg>
);
export const Expand = () => (
  <svg {...base}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
);
export const Shrink = () => (
  <svg {...base}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>
);
export const Pencil = () => (
  <svg {...base}><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
);
export const External = () => (
  <svg {...base}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
);
export const Home = () => (
  <svg {...base}><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>
);
export const Videos = () => (
  <svg {...base}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M10 9.5v5l4.5-2.5z" /></svg>
);
export const Chart = () => (
  <svg {...base}><path d="M5 20V12M12 20V5M19 20v-5" /></svg>
);
export const Cards = () => (
  <svg {...base}><rect x="4" y="7" width="13" height="13" rx="2" /><path d="M8 4h10a2 2 0 0 1 2 2v10" /></svg>
);
export const Search = () => (
  <svg {...base}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
);
export const ChevronLeft = () => (
  <svg {...base}><path d="m15 6-6 6 6 6" /></svg>
);
export const Install = () => (
  <svg {...base}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" /></svg>
);
export const BookMark = () => (
  <svg {...base} strokeWidth={2.2}><path d="M4 5.5h6a2 2 0 0 1 2 2V20a1.8 1.8 0 0 0-1.8-1.8H4zM20 5.5h-6a2 2 0 0 0-2 2V20a1.8 1.8 0 0 1 1.8-1.8H20z" /></svg>
);
export const Flame = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2c.6 3.2-1.4 4.9-3 6.7C7.4 10.5 6 12.3 6 15a6 6 0 0 0 12 0c0-2.4-1-4.3-2.3-5.8-.2 1.5-.9 2.6-2 3.1.4-3.7-.6-7.6-1.7-10.3z" />
  </svg>
);
export const Grip = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
);
export const Dots = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="5.5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18.5" cy="12" r="1.8" />
  </svg>
);
export const Eye = ({ off }: { off?: boolean }) => (
  <svg {...base}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);
