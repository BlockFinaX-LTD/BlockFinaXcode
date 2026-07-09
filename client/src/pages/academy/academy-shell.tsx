/**
 * academy-shell.tsx — the chrome around every lesson.
 *
 * - Sticky top bar: brand mark, breadcrumb, theme toggle, "Try the app" CTA.
 * - Left sidebar: full course tree, grouped, current lesson highlighted.
 * - Reading column: whatever the lesson component renders.
 * - Right rail: "In this lesson" TOC + read-time + level meta.
 * - Foot: prev/next book-turn cards.
 *
 * The shell is theme-aware and persists the user's choice under a shell-local
 * key so it doesn't collide with the main app's theme setting.
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
  const [location] = useLocation();

  useEffect(() => { setTheme(readTheme()); }, []);

  const flipTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch { /* noop */ }
      return next;
    });
  };

  // Progress = position in the catalog. It's a course-completion signal, not
  // a per-lesson scroll indicator — those are heavier and less honest.
  const { prev, next, index } = neighbourhood(slug);
  const progressPct = Math.max(0, Math.min(100, ((index + 1) / CATALOG.length) * 100));
  const groups = groupedCatalog();

  const lessonPath = (l: Lesson) => (l.slug ? `/learn/${l.slug}` : '/learn');

  // Reset scroll on lesson change — otherwise long lessons carry their
  // scroll position into short ones and feel broken.
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location]);

  return (
    <div className="bfx-academy" data-theme={theme}>
      <header className="ac-top">
        <div className="ac-top-in">
          <Link href="/" className="ac-brand">
            <span className="ac-brand-mark"><img src={logoPath} alt="" /></span>
            <span className="ac-brand-name">BlockFinaX <em>Academy</em></span>
          </Link>
          <span className="ac-crumb">
            <Link href="/learn">Course</Link>
            {lesson && slug !== '' && (
              <>
                <span className="sep">/</span>
                <span>{lesson.title}</span>
              </>
            )}
          </span>
          <div className="ac-top-actions">
            <Link href="/hedge" className="ac-btn primary" style={{ height: 32, padding: '0 14px', fontSize: 12 }}>
              Try the app
            </Link>
            <button className="icon-btn" onClick={flipTheme} aria-label="Toggle theme">
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
        <div className="ac-progress"><i style={{ width: `${progressPct}%` }} /></div>
      </header>

      <div className="ac-shell">
        <aside className="ac-side">
          <div className="ac-side-title">Course</div>
          {groups.map((g, gi) => (
            <div className="ac-group" key={g.name}>
              <div className="ac-group-head">
                <span className="num">{String(gi + 1).padStart(2, '0')}</span>
                {g.name}
              </div>
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

        <main className="ac-main">
          {children}
          {lesson && (
            <nav className="ac-nav" aria-label="Lesson navigation">
              {prev ? (
                <Link href={lessonPath(prev)}>
                  <span className="lbl">← Previous</span>
                  <span className="ttl">{prev.title}</span>
                </Link>
              ) : <span />}
              {next ? (
                <Link href={lessonPath(next)} className="next">
                  <span className="lbl">Next →</span>
                  <span className="ttl">{next.title}</span>
                </Link>
              ) : <span />}
            </nav>
          )}
        </main>

        {lesson && lesson.toc.length > 0 && (
          <aside className="ac-rail">
            <div className="ac-rail-label">In this lesson</div>
            <div className="ac-rail-meta">
              <span><strong>{lesson.readMin}</strong>min read</span>
              <span><strong>{lesson.level}</strong></span>
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
