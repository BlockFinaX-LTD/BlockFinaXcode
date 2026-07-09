/**
 * academy-shell.tsx. Chrome around every lesson.
 *
 * Sticky top bar, left sidebar (drawer on mobile), reading column,
 * right rail with the lesson TOC, prev/next cards at the foot.
 * Theme is local to the shell, persisted so it survives reloads.
 */
import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CATALOG, findLesson, neighbourhood, groupedCatalog, Lesson } from './catalog';
import './academy.css';

const logoPath = '/favicon.png';
const THEME_KEY = 'bfx-academy-theme';
type Theme = 'dark' | 'light';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

interface Props {
  slug: string;
  children: ReactNode;
}

export function AcademyShell({ slug, children }: Props) {
  const lesson = findLesson(slug);
  const [theme, setTheme] = useState<Theme>('dark');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => { setTheme(readTheme()); }, []);

  const flipTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch { /* noop */ }
      return next;
    });
  };

  const { prev, next, index } = neighbourhood(slug);
  const progressPct = Math.max(0, Math.min(100, ((index + 1) / CATALOG.length) * 100));
  const groups = groupedCatalog();
  const lessonPath = (l: Lesson) => (l.slug ? `/learn/${l.slug}` : '/learn');

  // Reset scroll + close drawer on route change.
  useEffect(() => {
    setDrawerOpen(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <div className="bfx-academy" data-theme={theme}>
      <header className="ac-top">
        <div className="ac-top-in">
          <button
            className="icon-btn ac-menu-btn"
            aria-label="Open course menu"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </button>

          <Link href="/" className="ac-brand">
            <span className="ac-brand-mark"><img src={logoPath} alt="" /></span>
            <span className="ac-brand-name">BlockFinaX <em>Academy</em></span>
          </Link>

          <span className="ac-crumb">
            {lesson && slug !== '' && (
              <>
                <Link href="/learn">Course</Link>
                <span className="sep">/</span>
                <span>{lesson.title}</span>
              </>
            )}
          </span>

          <div className="ac-top-actions">
            <Link href="/hedge" className="ac-btn primary">Open app</Link>
            <button className="icon-btn" onClick={flipTheme} aria-label="Toggle theme">
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
        <div className="ac-progress"><i style={{ width: `${progressPct}%` }} /></div>
      </header>

      <div className="ac-shell">
        <aside className={`ac-side${drawerOpen ? ' on' : ''}`}>
          <div className="ac-side-title">Course</div>
          {groups.map((g) => (
            <div className="ac-group" key={g.name}>
              <div className="ac-group-head">{g.name}</div>
              <ul>
                {g.items.map((l) => {
                  const idx = CATALOG.indexOf(l);
                  const on = l.slug === slug;
                  return (
                    <li key={l.slug || 'start'}>
                      <Link href={lessonPath(l)} className={`ac-side-link${on ? ' on' : ''}`}>
                        <span className="n">{String(idx + 1).padStart(2, '0')}</span>
                        <span>{l.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </aside>

        <div
          className={`ac-scrim${drawerOpen ? ' on' : ''}`}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />

        <main className="ac-main">
          {children}
          {lesson && (
            <nav className="ac-nav" aria-label="Lesson navigation">
              {prev ? (
                <Link href={lessonPath(prev)}>
                  <span className="lbl">Previous</span>
                  <span className="ttl">{prev.title}</span>
                </Link>
              ) : <span />}
              {next ? (
                <Link href={lessonPath(next)} className="next">
                  <span className="lbl">Next</span>
                  <span className="ttl">{next.title}</span>
                </Link>
              ) : <span />}
            </nav>
          )}
        </main>

        {lesson && lesson.toc.length > 0 && (
          <aside className="ac-rail">
            <div className="ac-rail-label">On this page</div>
            <div className="ac-rail-meta">
              <span><strong>{lesson.readMin}</strong> min read</span>
              <span>{lesson.level}</span>
            </div>
            <ul>
              {lesson.toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="ac-rail-link">{t.label}</a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
