import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useRoute } from './lib/router.ts';
import { api } from './lib/api.ts';
import { useLoad } from './lib/useLoad.ts';
import { useOnChanged } from './lib/events.ts';
import { colorVar, pct } from './lib/format.ts';
import { BookMark, Cards, Chart, Check, ChevronLeft, Flame, Home, Install, Moon, Pencil, Search, Sun, Videos } from './components/icons.tsx';
import { SearchPalette } from './components/Search.tsx';
import { PageBoundary } from './components/ui.tsx';
import { TodayPage } from './pages/Today.tsx';
import { LibraryPage } from './pages/Library.tsx';
import { SourcePage } from './pages/Source.tsx';
import { GroupPage } from './pages/Group.tsx';
import { WatchPage } from './pages/Watch.tsx';
import { ProgressPage } from './pages/Progress.tsx';
import { NotesPage } from './pages/Notes.tsx';
import { CardsPage } from './pages/Cards.tsx';
import { ReviewPage } from './pages/Review.tsx';
import type { Sidebar } from './types.ts';

type Theme = 'dark' | 'light';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function initialTheme(): Theme {
  const saved = stored('sb-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

// Chrome's install prompt event, which TypeScript's DOM types don't include.
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

const NAV = [
  ['today', '#/', 'Today', <Home key="i" />],
  ['library', '#/library', 'Library', <Videos key="i" />],
  ['cards', '#/cards', 'Flashcards', <Cards key="i" />],
  ['progress', '#/progress', 'Progress', <Chart key="i" />],
  ['notes', '#/notes', 'Notes', <Pencil key="i" />],
] as const;

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function App() {
  const route = useRoute();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [focus, setFocus] = useState(false);
  const [collapsed, setCollapsed] = useState(() => stored('sb-side') === '1');
  const [searching, setSearching] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const side = useLoad(() => api.get<Sidebar>('/sidebar'));
  const { reload } = side;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store('sb-theme', theme);
    // The installed app's title bar follows the chosen theme, not just the OS one.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', theme === 'dark' ? '#0e1015' : '#f4f8fb');
      m.removeAttribute('media');
    });
  }, [theme]);

  useEffect(() => store('sb-side', collapsed ? '1' : '0'), [collapsed]);

  // Focus mode only exists on the watch page; the sidebar numbers can change on any page.
  useEffect(() => {
    if (route.name !== 'watch') setFocus(false);
    reload();
  }, [route.name, route.id, reload]);
  useOnChanged(useCallback(() => reload(), [reload]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching((s) => !s);
      } else if (e.key === '[' && !e.ctrlKey && !e.metaKey && !typing(e.target)) {
        setCollapsed((c) => !c);
      }
    };
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    const onInstalled = () => setInstall(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Group, playlist and video pages belong to a group in the sidebar, not to a main section.
  const section = ['source', 'group', 'watch'].includes(route.name) ? '' : route.name === 'review' ? 'cards' : route.name;
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  let page;
  switch (route.name) {
    case 'library':
      page = <LibraryPage />;
      break;
    case 'source':
      page = <SourcePage id={route.id!} />;
      break;
    case 'group':
      page = <GroupPage id={route.id!} />;
      break;
    case 'watch':
      page = <WatchPage id={route.id!} focus={focus} setFocus={setFocus} />;
      break;
    case 'progress':
      page = <ProgressPage />;
      break;
    case 'notes':
      page = <NotesPage />;
      break;
    case 'cards':
      page = <CardsPage />;
      break;
    case 'review':
      page = <ReviewPage />;
      break;
    default:
      page = <TodayPage />;
  }

  const brand = (
    <a href="#/" className="brand" title="Study Buddy">
      <span className="brand-mark">
        <BookMark />
      </span>
      <span className="lbl">Study Buddy</span>
    </a>
  );

  return (
    <>
      <div className="ambient" aria-hidden>
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>
      <div className={`app${collapsed ? ' collapsed' : ''}${focus ? ' focus' : ''}`}>
        {!focus && (
          <>
            <header className="mtop">
              {brand}
              <span className="streak" title={`${side.data?.streak ?? 0}-day streak`}>
                <Flame />
                {side.data?.streak ?? 0}
              </span>
              <button className="icon-btn" onClick={() => setSearching(true)} aria-label="Search">
                <Search />
              </button>
              <button className="icon-btn" onClick={toggleTheme} aria-label={themeLabel}>
                {theme === 'dark' ? <Sun /> : <Moon />}
              </button>
            </header>

            <aside className="sidebar card" aria-label="Sidebar">
              <div className="side-top">
                {brand}
                <button
                  className="icon-btn collapse-btn"
                  onClick={() => setCollapsed(!collapsed)}
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  title={`${collapsed ? 'Expand' : 'Collapse'} sidebar ( [ )`}
                >
                  <ChevronLeft />
                </button>
              </div>
              <nav className="snav" aria-label="Main">
                {NAV.map(([key, href, label, icon]) => (
                  <a
                    key={key}
                    href={href}
                    className={section === key ? 'on' : ''}
                    aria-current={section === key ? 'page' : undefined}
                    title={label}
                  >
                    {icon}
                    <span className="lbl">{label}</span>
                  </a>
                ))}
                <button onClick={() => setSearching(true)} title="Search (Ctrl K)">
                  <Search />
                  <span className="lbl">Search</span>
                  <kbd className="lbl">Ctrl K</kbd>
                </button>
              </nav>

              {!!side.data?.groups.length && (
                <div className="side-groups">
                  <div className="side-label lbl">Groups</div>
                  {side.data.groups.map((g) => (
                    <a
                      key={g.id}
                      href={`#/group/${g.id}`}
                      className={`g-link${route.name === 'group' && route.id === g.id ? ' on' : ''}`}
                      aria-current={route.name === 'group' && route.id === g.id ? 'page' : undefined}
                      style={{ '--c': colorVar(g.color) } as CSSProperties}
                      title={`${g.name} · ${pct(g.done, g.total)}`}
                    >
                      <span className="dot" />
                      <span className="lbl g-name">{g.name}</span>
                      <span className="lbl g-pct">{g.total > 0 && g.done === g.total ? <Check /> : pct(g.done, g.total)}</span>
                    </a>
                  ))}
                </div>
              )}

              <div className="side-foot">
                {install && (
                  <button
                    className="btn btn-sm install-btn"
                    onClick={() => install.prompt().finally(() => setInstall(null))}
                    title="Install Study Buddy as an app"
                  >
                    <Install />
                    <span className="lbl">Install app</span>
                  </button>
                )}
                <div className="side-foot-row">
                  <span className="streak" title={`${side.data?.streak ?? 0}-day streak`}>
                    <Flame />
                    <span className="lbl">
                      {side.data?.streak ?? 0} {side.data?.streak === 1 ? 'day' : 'days'}
                    </span>
                  </span>
                  <button className="icon-btn" onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}>
                    {theme === 'dark' ? <Sun /> : <Moon />}
                  </button>
                </div>
              </div>
            </aside>
          </>
        )}

        <main className="main">
          <PageBoundary key={`${route.name}/${route.id ?? ''}`}>{page}</PageBoundary>
        </main>
      </div>

      {!focus && (
        <nav className="tabbar" aria-label="Main">
          {NAV.map(([key, href, label, icon]) => (
            <TabLink key={key} href={href} on={section === key} label={label === 'Flashcards' ? 'Cards' : label}>
              {icon}
            </TabLink>
          ))}
        </nav>
      )}

      {searching && <SearchPalette onClose={() => setSearching(false)} />}
    </>
  );
}

function TabLink({ href, on, label, children }: { href: string; on: boolean; label: string; children: ReactNode }) {
  return (
    <a href={href} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
      {children}
      {label}
    </a>
  );
}
