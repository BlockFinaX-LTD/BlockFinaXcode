/**
 * website.tsx — Public landing page.
 *
 * Dark-by-default with a light-mode toggle. The structure follows the
 * Claude Design handoff:
 *   nav → hero (rotator + 3D vol surface canvas)
 *   → three feature cards (Hedge / Yield / Trade) each with a live viz
 *   → three payoff-diagram cards (Insure / Underwrite / Bet either side)
 *   → signal section (marching-squares contour field + rotating word)
 *   → tail CTA → footer
 *
 * All canvases use requestAnimationFrame with cleanup; everything respects
 * prefers-reduced-motion. The theme attribute lives on the `.bfx-landing`
 * root so the rest of the app stays unaffected.
 */

import { Link } from 'wouter';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './website.css';

const logoPath = '/favicon.png';

// ── Theme ───────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light';
const THEME_KEY = 'bfx-theme';

function readStoredTheme(): Theme {
  // Light is the default. Users who explicitly toggled to dark keep it.
  if (typeof window === 'undefined') return 'light';
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

// ── Canvas helpers ──────────────────────────────────────────────────────

function fitCanvas(cv: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, r.width);
  const h = Math.max(1, r.height);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ── Hero rotating 3D wireframe vol surface ──────────────────────────────

function useHeroSurface(ref: React.RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const REDUCED = prefersReducedMotion();
    let d = fitCanvas(cv);
    const t0 = performance.now();
    let raf = 0;
    const onResize = () => { d = fitCanvas(cv); };
    window.addEventListener('resize', onResize, { passive: true });

    const COLS = 36;
    const ROWS = 26;

    function surfaceHeight(x: number, z: number, t: number) {
      return 0.40 * x * x - 0.10 * x + 0.13 * z
        + 0.055 * Math.sin(3.0 * x + t) * Math.cos(2.2 * z - t * 0.8)
        - 0.17;
    }

    function frame(now: number) {
      const t = REDUCED ? 0.6 : (now - t0) / 1000;
      const { ctx, w: W, h: H } = d;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H * 0.54;
      // R drives the projected size of the surface. 0.34 keeps the rotated
      // corners and their perspective amplification inside the canvas width
      // for the hero-visual column ratio we ship.
      const R = Math.min(W, H) * 0.34;
      const ay = -0.55 + Math.sin(t * 0.16) * 0.5;
      const ax = 0.6;
      const cosY = Math.cos(ay), sinY = Math.sin(ay);
      const cosX = Math.cos(ax), sinX = Math.sin(ax);

      function proj(i: number, j: number) {
        const x = (i / (COLS - 1)) * 2 - 1;
        const z = (j / (ROWS - 1)) * 2 - 1;
        const y = surfaceHeight(x, z, t);
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        const y1 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        const persp = 2.3 / (2.3 + z2);
        return { x: cx + x1 * R * persp, y: cy - y1 * R * persp, h: y, z: z2 };
      }

      const pts: ReturnType<typeof proj>[][] = [];
      for (let j = 0; j < ROWS; j++) {
        pts[j] = [];
        for (let i = 0; i < COLS; i++) pts[j][i] = proj(i, j);
      }

      function stroke(a: ReturnType<typeof proj>, b: ReturnType<typeof proj>) {
        const front = Math.max(0, Math.min(1, (1.4 - (a.z + b.z)) / 2.8));
        const tt = Math.max(0, Math.min(1, ((a.h + b.h) / 2 + 0.3) / 0.72));
        const g = Math.round(108 + (182 - 108) * tt);
        const alpha = 0.10 + 0.62 * front;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(45,${g},255,${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (let j = 0; j < ROWS; j++)
        for (let i = 0; i < COLS - 1; i++) stroke(pts[j][i], pts[j][i + 1]);
      for (let i = 0; i < COLS; i++)
        for (let j = 0; j < ROWS - 1; j++) stroke(pts[j][i], pts[j + 1][i]);

      if (!REDUCED) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [ref]);
}

// ── Hero rotator ────────────────────────────────────────────────────────

const ROTATOR_WORDS = ['Hedging', 'Trading', 'Insuring', 'Underwriting'];

function HeroRotator() {
  const ref = useRef<HTMLSpanElement>(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    let timeout: number;
    const id = window.setInterval(() => {
      el.style.transition = 'opacity .32s ease, transform .32s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      timeout = window.setTimeout(() => {
        setIdx((i) => (i + 1) % ROTATOR_WORDS.length);
        el.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
          el.style.opacity = '1';
          el.style.transform = 'translateY(0)';
        });
      }, 320);
    }, 2300);
    return () => { clearInterval(id); clearTimeout(timeout); };
  }, []);
  return <span ref={ref} className="rotator">{ROTATOR_WORDS[idx]}</span>;
}

// ── Hedge viz: value line caught at the protection floor ────────────────

function HedgeViz({ theme }: { theme: Theme }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const REDUCED = prefersReducedMotion();
    const tint = '45,108,255';
    const ink = theme === 'light' ? '18,26,45' : '255,255,255';
    const N = 64;
    const floor = 0.34;
    const data: number[] = [];
    let v = 0.72;
    for (let i = 0; i < N; i++) {
      v += (Math.random() - 0.5) * 0.10 + (0.72 - v) * 0.05;
      if (Math.random() < 0.10) v -= 0.34;
      v = Math.max(0.08, Math.min(0.96, v));
      data.push(v);
    }
    let d = fitCanvas(cv);
    const onResize = () => { d = fitCanvas(cv); draw(); };
    window.addEventListener('resize', onResize, { passive: true });

    function draw() {
      const { ctx, w: W, h: H } = d;
      ctx.clearRect(0, 0, W, H);
      const Y = (val: number) => 8 + (1 - val) * (H - 16);
      const X = (i: number) => (i / (N - 1)) * W;
      const fy = Y(floor);

      ctx.beginPath();
      ctx.moveTo(0, fy);
      for (let j = 0; j < N; j++) ctx.lineTo(X(j), Y(Math.min(data[j], floor)));
      ctx.lineTo(W, fy);
      ctx.closePath();
      ctx.fillStyle = `rgba(${tint},0.18)`;
      ctx.fill();

      ctx.beginPath();
      for (let k = 0; k < N; k++) {
        const x = X(k), y = Y(data[k]);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${ink},0.18)`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(0, fy);
      ctx.lineTo(W, fy);
      ctx.strokeStyle = `rgba(${tint},0.55)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      for (let m = 0; m < N; m++) {
        const hx = X(m), hy = Y(Math.max(data[m], floor));
        if (m === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
      }
      ctx.strokeStyle = `rgba(${tint},0.98)`;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(X(N - 1), Y(Math.max(data[N - 1], floor)), 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${tint},1)`;
      ctx.fill();
    }

    function updateStatus() {
      const el = statusRef.current;
      if (!el) return;
      const covered = data[N - 1] < floor;
      el.textContent = covered ? 'Downside covered' : 'Protected';
      el.classList.toggle('on', covered);
    }

    draw();
    updateStatus();

    if (REDUCED) {
      return () => { window.removeEventListener('resize', onResize); };
    }

    const id = window.setInterval(() => {
      v += (Math.random() - 0.5) * 0.10 + (0.72 - v) * 0.05;
      if (Math.random() < 0.11) v -= 0.34;
      v = Math.max(0.08, Math.min(0.96, v));
      data.push(v); data.shift();
      draw();
      updateStatus();
    }, 900);
    return () => { clearInterval(id); window.removeEventListener('resize', onResize); };
  }, [theme]);

  return (
    <div className="feat-viz">
      <canvas ref={cvRef} className="hedge-canvas" aria-hidden="true" />
      <div className="hedge-foot">
        <span ref={statusRef} className="hedge-status">Downside covered</span>
        <span className="hedge-key"><i />Protection floor</span>
      </div>
    </div>
  );
}

// ── Yield viz: APR counter + utilization bar ────────────────────────────

function YieldViz() {
  const aprRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const utilRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const REDUCED = prefersReducedMotion();
    const targetApr = 20.0;
    const targetUtil = 72;
    const aprEl = aprRef.current;
    const fillEl = fillRef.current;
    const utilEl = utilRef.current;
    if (!aprEl) return;

    if (REDUCED) {
      aprEl.textContent = targetApr.toFixed(1);
      if (fillEl) fillEl.style.width = `${targetUtil}%`;
      if (utilEl) utilEl.textContent = `${targetUtil}%`;
      return;
    }

    let started = false;
    let loopId = 0;
    let raf = 0;

    function run() {
      if (started) return;
      started = true;
      if (fillEl) requestAnimationFrame(() => { fillEl.style.width = `${targetUtil}%`; });
      const t0 = performance.now();
      function step(now: number) {
        const p = Math.min(1, (now - t0) / 1400);
        const e = 1 - Math.pow(1 - p, 3);
        if (aprEl) aprEl.textContent = (targetApr * e).toFixed(1);
        if (utilEl) utilEl.textContent = `${Math.round(targetUtil * e)}%`;
        if (p < 1) raf = requestAnimationFrame(step);
        else {
          loopId = window.setInterval(() => {
            if (aprEl) aprEl.textContent = (targetApr + (Math.random() - 0.5) * 0.6).toFixed(1);
          }, 1600);
        }
      }
      raf = requestAnimationFrame(step);
    }

    let io: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) { run(); io?.disconnect(); } });
      }, { threshold: 0.4 });
      io.observe(aprEl);
    }
    const fallback = window.setTimeout(run, 1200);
    return () => {
      clearTimeout(fallback);
      clearInterval(loopId);
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);

  return (
    <div className="feat-viz">
      <div className="yld">
        <div className="yld-apr">
          <span ref={aprRef} className="yld-num">0.0</span>
          <span className="yld-pct">% APR</span>
        </div>
        <div className="yld-label">Premium earned on collateral</div>
        <div className="yld-bar"><div ref={fillRef} className="yld-fill" /></div>
        <div className="yld-foot"><span>Utilization</span><span ref={utilRef}>0%</span></div>
      </div>
    </div>
  );
}

// ── Trade viz: long/short toggle + scrolling tape ───────────────────────

function TradeViz() {
  const tapeRef = useRef<HTMLCanvasElement>(null);
  const ivRef = useRef<HTMLSpanElement>(null);
  const [side, setSide] = useState<'long' | 'short'>('long');

  useEffect(() => {
    const cv = tapeRef.current;
    if (!cv) return;
    const REDUCED = prefersReducedMotion();
    const tint = '111,140,255';
    const N = 60;
    const data: number[] = [];
    let v = 0;
    for (let i = 0; i < N; i++) { v += (Math.random() - 0.5) * 6; data.push(v); }
    let d = fitCanvas(cv);
    const onResize = () => { d = fitCanvas(cv); };
    window.addEventListener('resize', onResize, { passive: true });

    function draw() {
      const { ctx, w: W, h: H } = d;
      ctx.clearRect(0, 0, W, H);
      const min = Math.min(...data), max = Math.max(...data);
      const rng = max - min || 1;
      const X = (i: number) => (i / (N - 1)) * W;
      const Y = (val: number) => 6 + (1 - (val - min) / rng) * (H - 12);

      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < N; i++) ctx.lineTo(X(i), Y(data[i]));
      ctx.lineTo(W, H);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgba(${tint},0.22)`);
      g.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      for (let j = 0; j < N; j++) {
        if (j === 0) ctx.moveTo(X(j), Y(data[j]));
        else ctx.lineTo(X(j), Y(data[j]));
      }
      ctx.strokeStyle = `rgba(${tint},0.95)`;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(X(N - 1), Y(data[N - 1]), 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${tint},1)`;
      ctx.fill();
    }

    draw();
    if (REDUCED) {
      return () => { window.removeEventListener('resize', onResize); };
    }
    const id = window.setInterval(() => {
      const step = (Math.random() - 0.5) * 8;
      data.push(data[data.length - 1] + step);
      data.shift();
      draw();
      if (ivRef.current) {
        const iv = 18 + Math.abs(step) * 1.4 + Math.random() * 4;
        ivRef.current.textContent = `${iv.toFixed(1)}%`;
      }
    }, 900);
    return () => { clearInterval(id); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div className="feat-viz">
      <div className="trd">
        <div className="trd-toggle">
          <button
            type="button"
            className={`trd-side${side === 'long' ? ' is-active' : ''}`}
            onClick={() => setSide('long')}
          >
            Long vol
          </button>
          <button
            type="button"
            className={`trd-side${side === 'short' ? ' is-active' : ''}`}
            onClick={() => setSide('short')}
          >
            Short vol
          </button>
        </div>
        <canvas ref={tapeRef} className="trd-tape" aria-hidden="true" />
        <div className="trd-foot">
          <span>Implied vol</span>
          <span ref={ivRef} className="trd-iv">24.8%</span>
        </div>
      </div>
    </div>
  );
}

// ── Signal: marching-squares contour field ──────────────────────────────

function useSignalCanvas(ref: React.RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const REDUCED = prefersReducedMotion();
    let d = fitCanvas(cv);
    const t0 = performance.now();
    let raf = 0;
    const onResize = () => { d = fitCanvas(cv); };
    window.addEventListener('resize', onResize, { passive: true });

    const levels = [0.12, 0.19, 0.28, 0.38, 0.50, 0.64, 0.80, 0.98, 1.18, 1.40, 1.62];

    function frame(now: number) {
      const t = REDUCED ? 0 : (now - t0) / 1000;
      const { ctx, w: W, h: H } = d;
      ctx.clearRect(0, 0, W, H);

      const cols = 70;
      const rows = Math.max(20, Math.round(cols * H / W));
      const gw = W / (cols - 1), gh = H / (rows - 1);
      const cx = W * 0.5, cy = H * 0.5;
      const sep = W * 0.15 + Math.sin(t * 0.22) * W * 0.025;
      const p1x = cx - sep, p2x = cx + sep;
      const p1y = cy + Math.sin(t * 0.28) * H * 0.05;
      const p2y = cy - Math.sin(t * 0.28) * H * 0.05;
      const s = Math.min(W, H) * 0.32;
      const s2 = 2 * s * s;

      const vals = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * gw, y = j * gh;
          const dx1 = x - p1x, dy1 = y - p1y;
          const dx2 = x - p2x, dy2 = y - p2y;
          vals[j * cols + i] = Math.exp(-(dx1 * dx1 + dy1 * dy1) / s2)
                             + Math.exp(-(dx2 * dx2 + dy2 * dy2) / s2);
        }
      }

      for (let L = 0; L < levels.length; L++) {
        const lv = levels[L];
        ctx.beginPath();
        for (let jj = 0; jj < rows - 1; jj++) {
          for (let ii = 0; ii < cols - 1; ii++) {
            const x0 = ii * gw, y0 = jj * gh;
            const a = vals[jj * cols + ii];
            const b = vals[jj * cols + ii + 1];
            const c = vals[(jj + 1) * cols + ii + 1];
            const e = vals[(jj + 1) * cols + ii];
            const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (e > lv ? 1 : 0);
            if (idx === 0 || idx === 15) continue;
            const tX = x0 + gw * ((lv - a) / (b - a)), tY = y0;
            const rX = x0 + gw, rY = y0 + gh * ((lv - b) / (c - b));
            const bX = x0 + gw * ((lv - e) / (c - e)), bY = y0 + gh;
            const lX = x0, lY = y0 + gh * ((lv - a) / (e - a));
            switch (idx) {
              case 1: ctx.moveTo(lX, lY); ctx.lineTo(bX, bY); break;
              case 2: ctx.moveTo(bX, bY); ctx.lineTo(rX, rY); break;
              case 3: ctx.moveTo(lX, lY); ctx.lineTo(rX, rY); break;
              case 4: ctx.moveTo(tX, tY); ctx.lineTo(rX, rY); break;
              case 5: ctx.moveTo(lX, lY); ctx.lineTo(tX, tY); ctx.moveTo(bX, bY); ctx.lineTo(rX, rY); break;
              case 6: ctx.moveTo(tX, tY); ctx.lineTo(bX, bY); break;
              case 7: ctx.moveTo(lX, lY); ctx.lineTo(tX, tY); break;
              case 8: ctx.moveTo(tX, tY); ctx.lineTo(lX, lY); break;
              case 9: ctx.moveTo(tX, tY); ctx.lineTo(bX, bY); break;
              case 10: ctx.moveTo(tX, tY); ctx.lineTo(rX, rY); ctx.moveTo(lX, lY); ctx.lineTo(bX, bY); break;
              case 11: ctx.moveTo(tX, tY); ctx.lineTo(rX, rY); break;
              case 12: ctx.moveTo(lX, lY); ctx.lineTo(rX, rY); break;
              case 13: ctx.moveTo(bX, bY); ctx.lineTo(rX, rY); break;
              case 14: ctx.moveTo(lX, lY); ctx.lineTo(bX, bY); break;
            }
          }
        }
        const alpha = 0.07 + (L / levels.length) * 0.34;
        ctx.strokeStyle = `rgba(45,108,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (!REDUCED) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [ref]);
}

// ── Signal rotator ──────────────────────────────────────────────────────

const SIGNAL_WORDS = ['see', 'hedge', 'trade'];

function SignalRotator() {
  const ref = useRef<HTMLSpanElement>(null);
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    let timeout: number;
    const id = window.setInterval(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      timeout = window.setTimeout(() => {
        setIdx((i) => (i + 1) % SIGNAL_WORDS.length);
        el.style.opacity = '1';
        el.style.transform = 'none';
      }, 240);
    }, 2200);
    return () => { clearInterval(id); clearTimeout(timeout); };
  }, []);
  return <span ref={ref} className="rot">{SIGNAL_WORDS[idx]}</span>;
}

// ── Nav ─────────────────────────────────────────────────────────────────

function TopNav({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`nav${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap">
        <Link href="/" className="brand" aria-label="BlockFinaX home">
          <span className="mark"><img src={logoPath} alt="" /></span>
          BlockFinaX
        </Link>
        <div className="nav-links">
          <a href="#use">Products</a>
          <Link href="/hedger">Hedgers</Link>
          <Link href="/liquidity-provider">Underwriters</Link>
          <div
            className="nav-dropdown"
            onMouseEnter={() => setResourcesOpen(true)}
            onMouseLeave={() => setResourcesOpen(false)}
          >
            <button type="button" className="nav-dropdown-trigger">
              Resources <ChevronDown />
            </button>
            {resourcesOpen && (
              <div className="nav-dropdown-menu">
                <Link href="/docs/request">Documentation</Link>
                <Link href="/whitepaper">Whitepaper</Link>
                <Link href="/pitch">Pitch deck</Link>
                <Link href="/blog">Blog</Link>
              </div>
            )}
          </div>
        </div>
        <div className="nav-cta">
          <button
            type="button"
            className="theme-toggle"
            aria-label="Toggle light and dark theme"
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M20 14.5A8 8 0 0 1 9.5 4 6.5 6.5 0 1 0 20 14.5Z"
                  stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
                <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <a className="btn btn-ghost btn-sm" href="#use">Hedge</a>
          <Link href="/apply" className="btn btn-primary btn-sm">
            Trade <span className="arrow">→</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────

function Hero() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  useHeroSurface(cvRef);
  return (
    <header className="hero">
      <div className="wrap hero-inner">
        <div className="hero-grid2">
          <div className="hero-copy">
            <h1>
              <HeroRotator />
              <br />
              currency risk.
            </h1>
            <p className="hero-sub">
              The market to discover, trade and hedge FX risk in emerging markets.
            </p>
            <div className="hero-ctas">
              <Link href="/apply" className="btn btn-primary">
                Hedge <span className="arrow">→</span>
              </Link>
              <a href="#use" className="btn btn-ghost">Trade</a>
            </div>
          </div>
          <div className="hero-visual">
            <canvas ref={cvRef} className="hero-surface" aria-hidden="true" />
          </div>
        </div>
      </div>
    </header>
  );
}

// ── Use / three feature cards ───────────────────────────────────────────

function UseSection({ theme }: { theme: Theme }) {
  return (
    <section className="use" id="use">
      <div className="wrap">
        <div className="assets-head">
          <h2>Three ways to use it.</h2>
          <p>Hedge FX risk, earn premium on stablecoins, or trade either side.</p>
        </div>
        <div className="feats">
          <article className="feat t-blue">
            <HedgeViz theme={theme} />
            <div className="feat-body">
              <div className="feat-name">Hedge <span className="feat-pill">PROTECT</span></div>
              <p>Hedge FX risk to protect your capital.</p>
              <div className="feat-actions">
                <Link href="/hedger" className="feat-btn primary">
                  Hedge <span className="arrow">→</span>
                </Link>
                <Link href="/docs/request" className="feat-btn ghost">Learn more</Link>
              </div>
            </div>
          </article>

          <article className="feat t-azure">
            <YieldViz />
            <div className="feat-body">
              <div className="feat-name">Yield <span className="feat-pill">EARN</span></div>
              <p>Earn premiums on idle stablecoins.</p>
              <div className="feat-actions">
                <Link href="/liquidity-provider" className="feat-btn primary">
                  Yield <span className="arrow">→</span>
                </Link>
                <Link href="/docs/request" className="feat-btn ghost">Learn more</Link>
              </div>
            </div>
          </article>

          <article className="feat t-indigo">
            <TradeViz />
            <div className="feat-body">
              <div className="feat-name">Trade <span className="feat-pill">VOL</span></div>
              <p>Go long or short FX risk.</p>
              <div className="feat-actions">
                <Link href="/apply" className="feat-btn primary">
                  Trade <span className="arrow">→</span>
                </Link>
                <Link href="/docs/request" className="feat-btn ghost">Learn more</Link>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

// ── Markets / payoff cards ──────────────────────────────────────────────

function MarketsSection() {
  return (
    <section className="assets" id="markets">
      <div className="wrap">
        <div className="assets-head">
          <h2>Markets for volatile assets.</h2>
          <p>See the risk, then take a side.</p>
        </div>
        <div className="acards">

          <article className="acard t-blue">
            <h3>Insure against moves</h3>
            <svg className="payoff" viewBox="0 0 300 190" fill="none" aria-hidden="true">
              <line className="grid" x1="88" y1="22" x2="88" y2="158" />
              <line className="grid" x1="166" y1="22" x2="166" y2="158" />
              <line className="grid" x1="244" y1="22" x2="244" y2="158" />
              <line className="grid" x1="30" y1="50" x2="275" y2="50" />
              <line className="grid" x1="30" y1="158" x2="275" y2="158" />
              <line className="zero" x1="30" y1="104" x2="275" y2="104" />
              <line className="axis" x1="30" y1="22" x2="30" y2="168" />
              <line className="strike" x1="145" y1="22" x2="145" y2="168" />
              <path className="area" d="M169,104 L275,34 L275,104 Z" />
              <path className="curve" d="M30,120 L145,120 L275,34" />
              <circle className="spot" r="3" cx="275" cy="34" />
              <text className="lbl" x="148" y="32">Strike</text>
              <text className="lbl t" x="232" y="28">Payout</text>
              <text className="lbl" x="245" y="178">Rate →</text>
            </svg>
            <p>Buy cover and get paid out when the rate moves against you.</p>
            <Link href="/hedger" className="acard-cta">
              Buy cover <span className="arrow">→</span>
            </Link>
          </article>

          <article className="acard t-azure">
            <h3>Underwrite the risk</h3>
            <svg className="payoff" viewBox="0 0 300 190" fill="none" aria-hidden="true">
              <line className="grid" x1="88" y1="22" x2="88" y2="158" />
              <line className="grid" x1="166" y1="22" x2="166" y2="158" />
              <line className="grid" x1="244" y1="22" x2="244" y2="158" />
              <line className="grid" x1="30" y1="50" x2="275" y2="50" />
              <line className="grid" x1="30" y1="158" x2="275" y2="158" />
              <line className="zero" x1="30" y1="104" x2="275" y2="104" />
              <line className="axis" x1="30" y1="22" x2="30" y2="168" />
              <line className="strike" x1="150" y1="22" x2="150" y2="168" />
              <path className="area" d="M30,104 L30,86 L150,86 L150,104 Z" />
              <path className="curve" d="M30,86 L150,86 L275,166" />
              <circle className="spot" r="3" cx="30" cy="86" />
              <text className="lbl t" x="58" y="80">Premium</text>
              <text className="lbl" x="153" y="32">Strike</text>
              <text className="lbl" x="245" y="178">Rate →</text>
            </svg>
            <p>Set a strike and expiry, underwrite the risk, and earn the premium.</p>
            <Link href="/liquidity-provider" className="acard-cta">
              Underwrite <span className="arrow">→</span>
            </Link>
          </article>

          <article className="acard t-indigo">
            <h3>Bet on either side</h3>
            <svg className="payoff" viewBox="0 0 300 190" fill="none" aria-hidden="true">
              <line className="grid" x1="88" y1="22" x2="88" y2="158" />
              <line className="grid" x1="244" y1="22" x2="244" y2="158" />
              <line className="grid" x1="30" y1="50" x2="275" y2="50" />
              <line className="grid" x1="30" y1="158" x2="275" y2="158" />
              <line className="zero" x1="30" y1="104" x2="275" y2="104" />
              <line className="axis" x1="30" y1="22" x2="30" y2="168" />
              <line className="strike" x1="152" y1="22" x2="152" y2="168" />
              <path className="area" d="M30,46 L152,150 L275,46 Z" />
              <path className="curve-faint" d="M30,150 L152,46 L275,150" />
              <path className="curve" d="M30,46 L152,150 L275,46" />
              <circle className="spot" r="3" cx="152" cy="150" />
              <text className="lbl t" x="34" y="40">Long vol</text>
              <text className="lbl" x="34" y="162">Short vol</text>
              <text className="lbl" x="138" y="184">ATM</text>
            </svg>
            <p>Go long or short volatility and profit from the move either way.</p>
            <Link href="/apply" className="acard-cta">
              Trade volatility <span className="arrow">→</span>
            </Link>
          </article>

        </div>
      </div>
    </section>
  );
}

// ── Signal section ──────────────────────────────────────────────────────

function SignalSection() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  useSignalCanvas(cvRef);
  return (
    <section className="signal">
      <canvas ref={cvRef} aria-hidden="true" />
      <div className="wrap signal-inner">
        <h2 className="signal-title">
          Risk you can finally <SignalRotator />.
        </h2>
      </div>
    </section>
  );
}

// ── Tail CTA ────────────────────────────────────────────────────────────

function TailCTA() {
  return (
    <section className="tail">
      <div className="wrap">
        <h2>Trade and hedge FX risk.</h2>
        <p>Buy protection against FX risk, trade the risk.</p>
        <div className="hero-ctas">
          <Link href="/hedger" className="btn btn-primary">
            Hedge <span className="arrow">→</span>
          </Link>
          <Link href="/apply" className="btn btn-ghost">
            Trade
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Link href="/" className="brand">
              <span className="mark"><img src={logoPath} alt="" /></span>
              BlockFinaX
            </Link>
            <p>
              Markets for FX risk. Trade it, underwrite it to earn yield, or
              hedge against it to protect your money.
            </p>
          </div>
          <div className="foot-cols">
            <div className="foot-col">
              <h5>Product</h5>
              <Link href="/apply">Request access</Link>
              <Link href="/docs/request">Documentation</Link>
              <Link href="/hedger">For buyers</Link>
              <Link href="/liquidity-provider">For capital partners</Link>
            </div>
            <div className="foot-col">
              <h5>Resources</h5>
              <Link href="/whitepaper">Whitepaper</Link>
              <Link href="/pitch">Pitch deck</Link>
              <Link href="/blog">Blog</Link>
              <a href="mailto:hello@blockfinax.com">Contact</a>
            </div>
            <div className="foot-col">
              <h5>Social</h5>
              <div className="foot-socs">
                <a
                  href="https://x.com/blockfinax?s=21"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="foot-soc-btn"
                  aria-label="X"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
                  </svg>
                </a>
                <a
                  href="https://www.linkedin.com/company/blockfinax/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="foot-soc-btn"
                  aria-label="LinkedIn"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M20.45 20.45h-3.555v-5.57c0-1.328-.024-3.037-1.85-3.037-1.853 0-2.137 1.447-2.137 2.94v5.667H9.354V9h3.414v1.561h.048c.475-.9 1.636-1.85 3.367-1.85 3.6 0 4.267 2.37 4.267 5.452v6.287zM5.337 7.433a2.063 2.063 0 1 1 0-4.126 2.063 2.063 0 0 1 0 4.126zM7.114 20.45H3.558V9h3.556v11.45z" />
                  </svg>
                </a>
                <a
                  href="https://t.me/+4flz7LGYq_82YTM8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="foot-soc-btn"
                  aria-label="Telegram"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M21.84 3.61a1.55 1.55 0 0 0-1.59-.23L2.5 10.48a1.36 1.36 0 0 0 .09 2.56l3.83 1.27 2.13 6.86a1.35 1.35 0 0 0 2.21.56l2.37-2.13 4.16 3.05a1.36 1.36 0 0 0 2.14-.84l3-16.29a1.55 1.55 0 0 0-.59-1.91zM9.71 14.93l-.43 4.18-1.66-5.32L17.3 7.5l-7.59 7.43z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
        <div className="foot-bottom">
          <span>© {new Date().getFullYear()} BlockFinaX. All rights reserved.</span>
          <div className="foot-legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ── Geist font loader ───────────────────────────────────────────────────

function useGeistFont() {
  useEffect(() => {
    if (document.querySelector('link[data-bfx-geist]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&display=swap';
    link.setAttribute('data-bfx-geist', '1');
    document.head.appendChild(link);
  }, []);
}

// ── Main page ───────────────────────────────────────────────────────────

export default function Website() {
  useGeistFont();
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => { setTheme(readStoredTheme()); }, []);
  const toggleTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="bfx-landing" data-theme={theme}>
      <TopNav theme={theme} onToggleTheme={toggleTheme} />
      <Hero />
      <UseSection theme={theme} />
      <MarketsSection />
      <SignalSection />
      <TailCTA />
      <Footer />
    </div>
  );
}
