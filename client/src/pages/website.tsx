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
import { ChevronDown, Menu, X } from 'lucide-react';
import { FlagSvg } from '@/components/app-glyphs';
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

const ROTATOR_WORDS = ['Hedging', 'Managing', 'Pricing', 'Underwriting'];

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
    const targetApr = 70.0;
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

/** A benchmark rate around a protection level; the part above the level is covered. */
const RATE_PATH = [4.31, 4.33, 4.36, 4.34, 4.38, 4.41, 4.39, 4.44, 4.47, 4.45, 4.5, 4.53, 4.51, 4.57, 4.62, 4.66, 4.63, 4.69, 4.72, 4.68, 4.64, 4.61, 4.58, 4.55, 4.57, 4.6, 4.65, 4.7, 4.74, 4.71];
const RATE_CAP = 4.6;

function RateViz() {
  const W = 340, H = 74, min = 4.2, max = 4.85;
  const X = (i: number) => (i / (RATE_PATH.length - 1)) * W;
  const Y = (v: number) => 6 + (1 - (v - min) / (max - min)) * (H - 12);
  const line = RATE_PATH.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = `M0,${Y(RATE_CAP)} ${RATE_PATH.map((v, i) => `L${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')} L${W},${Y(RATE_CAP)} Z`;
  const last = RATE_PATH[RATE_PATH.length - 1];
  return (
    <div className="feat-viz">
      <div className="trd">
        <div className="trd-foot" style={{ marginBottom: 8 }}>
          <span>Benchmark rate</span>
          <span>--- Protected above {RATE_CAP.toFixed(2)}%</span>
        </div>
        <svg className="trd-tape" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id="rate-above"><rect x="0" y="0" width={W} height={Y(RATE_CAP)} /></clipPath>
          </defs>
          <path d={area} fill="var(--bfx-tint)" fillOpacity="0.2" clipPath="url(#rate-above)" />
          <line x1="0" x2={W} y1={Y(RATE_CAP)} y2={Y(RATE_CAP)} stroke="var(--bfx-tint)" strokeOpacity="0.55" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <path d={line} fill="none" stroke="var(--bfx-tint)" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <circle cx={X(RATE_PATH.length - 1)} cy={Y(last)} r="3" fill="var(--bfx-tint)" />
        </svg>
        <div className="trd-foot">
          <span>Covered above the level</span>
          <span className="trd-iv">{last.toFixed(2)}%</span>
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

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4 6.5 6.5 0 1 0 20 14.5Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TopNav({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileResourcesOpen, setMobileResourcesOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  // Close the mobile menu on Escape so keyboard users can dismiss it.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const closeMobile = () => { setMobileOpen(false); setMobileResourcesOpen(false); };

  return (
    <>
      <nav className={`nav${scrolled ? ' scrolled' : ''}`}>
        <div className="wrap">
          <Link href="/" className="brand" aria-label="BlockFinaX home">
            <span className="mark"><img src={logoPath} alt="" /></span>
            BlockFinaX
          </Link>
          <div className="nav-links">
            <a href="/#use">Products</a>
            <Link href="/hedger">Hedgers</Link>
            <Link href="/liquidity-provider">Underwriters</Link>
            <Link href="/about">About</Link>
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
                  <Link href="/blog">Blog</Link>
                  <Link href="/faq">FAQ</Link>
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
              {theme === 'dark' ? <MoonIcon /> : <SunIcon />}
            </button>
            <Link href="/hedge" className="btn btn-primary btn-sm">
              Launch App <span className="arrow">→</span>
            </Link>
          </div>
          <button
            type="button"
            className="nav-hamburger"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu />
          </button>
        </div>
      </nav>

      {mobileOpen && (
        <div className="nav-mobile-overlay" role="dialog" aria-modal="true" aria-label="Site menu">
          <div className="nav-mobile-top">
            <Link href="/" className="brand" onClick={closeMobile}>
              <span className="mark"><img src={logoPath} alt="" /></span>
              BlockFinaX
            </Link>
            <button
              type="button"
              className="nav-mobile-close"
              aria-label="Close menu"
              onClick={closeMobile}
            >
              <X />
            </button>
          </div>
          <div className="nav-mobile-body">
            <a href="#use" className="nav-mobile-link" onClick={closeMobile}>
              Products
            </a>
            <Link href="/hedger" className="nav-mobile-link" onClick={closeMobile}>
              Hedgers
            </Link>
            <Link href="/liquidity-provider" className="nav-mobile-link" onClick={closeMobile}>
              Underwriters
            </Link>
            <Link href="/about" className="nav-mobile-link" onClick={closeMobile}>
              About
            </Link>
            <button
              type="button"
              className="nav-mobile-link"
              onClick={() => setMobileResourcesOpen((o) => !o)}
              aria-expanded={mobileResourcesOpen}
            >
              Resources
              <ChevronDown className={`chev${mobileResourcesOpen ? ' open' : ''}`} />
            </button>
            {mobileResourcesOpen && (
              <div className="nav-mobile-resources">
                <Link href="/blog" onClick={closeMobile}>Blog</Link>
                <Link href="/faq" onClick={closeMobile}>FAQ</Link>
              </div>
            )}
            <button
              type="button"
              className="nav-mobile-theme"
              onClick={onToggleTheme}
            >
              Appearance
              <span className="pill">
                {theme === 'dark' ? <><MoonIcon /> Dark</> : <><SunIcon /> Light</>}
              </span>
            </button>
          </div>
          <div className="nav-mobile-ctas">
            <Link href="/hedge" className="btn btn-primary" onClick={closeMobile}>
              Launch App <span className="arrow">→</span>
            </Link>
          </div>
        </div>
      )}
    </>
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
              Making currency risk protection more accessible to support trade and investment in emerging markets.
            </p>
            <div className="hero-ctas">
              <Link href="/hedge" className="btn btn-primary">
                Launch App <span className="arrow">→</span>
              </Link>
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
          <p>Hedge FX risk, underwrite it for premium, or protect against interest-rate moves.</p>
        </div>
        <div className="feats">
          <article className="feat t-blue">
            <HedgeViz theme={theme} />
            <div className="feat-body">
              <div className="feat-name">Hedge <span className="feat-pill">PROTECT</span></div>
              <p>Hedge FX risk to protect your capital.</p>
              <div className="feat-actions">
                <Link href="/hedge" className="feat-btn primary">
                  Hedge <span className="arrow">→</span>
                </Link>
                <Link href="/hedger" className="feat-btn ghost">Learn more</Link>
              </div>
            </div>
          </article>

          <article className="feat t-azure">
            <YieldViz />
            <div className="feat-body">
              <div className="feat-name">Underwrite <span className="feat-pill">EARN</span></div>
              <p>Underwrite FX risk and earn premiums on idle stablecoins.</p>
              <div className="feat-actions">
                <Link href="/hedge" className="feat-btn primary">
                  Underwrite <span className="arrow">→</span>
                </Link>
                <Link href="/liquidity-provider" className="feat-btn ghost">Learn more</Link>
              </div>
            </div>
          </article>

          <article className="feat t-indigo">
            <RateViz />
            <div className="feat-body">
              <div className="feat-name">Interest rates <span className="feat-pill">SOON</span></div>
              <p>Protect loans and deposits against interest-rate moves.</p>
              <div className="feat-actions">
                <Link href="/contact" className="feat-btn ghost">Ask about early access</Link>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

// ── Who this is for / audience cards ─────────────────────────────────────


const PILLARS = [
  {
    n: '01',
    title: 'Making currency protection accessible',
    lede: 'Help businesses and investors protect their margins and returns against exchange-rate movements.',
    body: 'Most businesses that pay or earn in another currency have no practical way to protect it: forwards need a credit line and a dealer. BlockFinaX turns protection into a simple purchase. Choose the amount, the end date and the move you fear, pay a known premium in USDC, and get paid if the rate passes your strike.',
  },
  {
    n: '02',
    title: 'Mobilising capital for risk protection',
    lede: 'Connect private capital with businesses seeking currency protection.',
    body: 'Every protection is backed by underwriters who put USDC into currency pools and earn the premiums. The most a contract can pay is set aside the moment it is sold, so the cover on offer is always funded.',
  },
  {
    n: '03',
    title: 'Expanding protection to underserved currencies',
    lede: 'Bring hedging access to markets where suitable protection is limited.',
    body: 'Hedging is easiest to find in a handful of major currencies and for large clients. BlockFinaX pools cover the naira, the cedi, the shilling, the rand and the Egyptian pound, in amounts as small as a single supplier invoice.',
  },
];

/**
 * Fine engraved lines, like the guilloché on banknotes: rings that all pass through one
 * point, so they fan out from it, plus a few wavy loops. Drawn once; decorative only.
 */
function Guilloche() {
  const fx = 820, fy = 420;
  const rings: { d: string; dashed: boolean }[] = [];
  for (let i = 0; i < 46; i++) {
    const a = (200 + i * 3.2) * (Math.PI / 180);
    const r = 150 + (i % 9) * 34 + i * 2;
    const cx = fx + r * Math.cos(a);
    const cy = fy + r * Math.sin(a);
    const pts: string[] = [];
    const wobble = i % 3 === 0 ? 0.06 : 0;
    for (let k = 0; k <= 180; k++) {
      const t = (k / 180) * Math.PI * 2;
      const rr = r * (1 + wobble * Math.sin(5 * t + i));
      pts.push(`${(cx + rr * Math.cos(t)).toFixed(1)},${(cy + rr * 0.82 * Math.sin(t)).toFixed(1)}`);
    }
    rings.push({ d: `M${pts.join(' L')} Z`, dashed: i % 4 === 1 });
  }
  return (
    <svg className="guilloche" viewBox="0 0 1000 800" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      {rings.map((r, i) => (
        <path key={i} d={r.d} fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray={r.dashed ? '2 5' : undefined} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** Three pillars. The front says it all; the back adds detail for anyone who wants it. */
function PillarsSection() {
  const [flipped, setFlipped] = useState<string | null>(null);
  return (
    <section className="pillars" id="pillars" aria-labelledby="pillars-title">
      <Guilloche />
      <div className="wrap">
        <div className="why-head">
          <div>
            <div className="why-label">Why BlockFinaX matters</div>
            <h2 id="pillars-title">FX risk solutions for <span className="accent">emerging markets</span></h2>
          </div>
          <div className="why-copy">
            <p>
              An exchange-rate move can make a supplier payment more expensive, a foreign-currency loan heavier or an
              investment worth less. <strong>BlockFinaX lets you set your worst case in advance.</strong>
            </p>
          </div>
        </div>
        <div className="pillar-grid">
          {PILLARS.map((p) => (
            <button
              key={p.n}
              type="button"
              className={`pillar${flipped === p.n ? ' flipped' : ''}`}
              aria-pressed={flipped === p.n}
              aria-label={`${p.title}. ${p.lede} ${p.body}`}
              onClick={() => setFlipped((f) => (f === p.n ? null : p.n))}
            >
              <span className="pillar-inner" aria-hidden="true">
                <span className="pillar-face pillar-front">
                  <span className="pillar-num">{p.n}</span>
                  <span className="pillar-text">
                    <span className="pillar-title">{p.title}</span>
                    <span className="pillar-lede">{p.lede}</span>
                  </span>
                  <span className="pillar-more">More</span>
                </span>
                <span className="pillar-face pillar-back">
                  <span className="pillar-num on-dark">{p.n}</span>
                  <span className="pillar-body">{p.body}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

const TRUST = [
  { when: 'When you buy', title: 'Your payout is reserved', line: 'The most it can pay is set aside the moment you buy.' },
  { when: 'At the end date', title: 'The rate is agreed independently', line: 'Independent operators must agree the rate. No one party chooses it.' },
  { when: 'When you claim', title: 'Only you can collect it', line: 'Your payout waits for your passkey. Nobody else can move it.' },
];

const RECEIPT: { step: number; k: string; v: string; proof?: string }[] = [
  { step: 0, k: 'Protection', v: 'Cedi payables · $500,000' },
  { step: 0, k: 'Strike and cap', v: '11.83 to 13.01' },
  { step: 0, k: 'Reserve', v: '$50,862.07', proof: 'Locked at purchase' },
  { step: 1, k: 'USD/GHS at 14:00 UTC', v: '12.40', proof: 'Agreed by 2 operators' },
  { step: 2, k: 'Payout', v: '$24,077.59', proof: 'Claimed with your passkey' },
];

/** Why a business can rely on being paid: three steps beside a contract that fills in as they advance. */
function TrustSection() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || prefersReducedMotion()) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % 3), 3200);
    return () => clearInterval(id);
  }, [paused]);
  return (
    <section className="trust" id="trust" aria-labelledby="trust-title">
      <div className="wrap">
        <div className="assets-head">
          <h2 id="trust-title">Why you can trust the payout.</h2>
          <p>Protection is only worth buying if it pays. At every step, the rules are written into the contracts and recorded on a public ledger.</p>
        </div>
        <div className="trust-split" onMouseLeave={() => setPaused(false)}>
          <ol className="trust-steps">
            {TRUST.map((t, k) => (
              <li key={t.title}>
                <button type="button" className={step === k ? 'on' : ''} aria-pressed={step === k}
                  onMouseEnter={() => { setPaused(true); setStep(k); }} onFocus={() => { setPaused(true); setStep(k); }} onClick={() => { setPaused(true); setStep(k); }}>
                  <span className="trust-when">{String(k + 1).padStart(2, '0')} · {t.when}</span>
                  <span className="trust-title">{t.title}</span>
                  <span className="trust-text">{t.line}</span>
                  <span className="trust-bar" aria-hidden="true"><i key={paused ? 'p' : step} className={!paused && step === k ? 'run' : ''} /></span>
                </button>
              </li>
            ))}
          </ol>
          <div className="receipt" aria-label="An example protection contract">
            <div className="receipt-h">
              <span>Protection #1042</span>
              <span className={`receipt-status s${step}`}>{step === 0 ? 'Active' : step === 1 ? 'Settled' : 'Paid'}</span>
            </div>
            <dl>
              {RECEIPT.map((r) => (
                <div key={r.k} className={`receipt-row${r.step <= step ? ' shown' : ''}${r.step === step ? ' now' : ''}`}>
                  <dt>{r.k}</dt>
                  <dd>
                    <span className="v">{r.v}</span>
                    {r.proof && <span className="proof"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>{r.proof}</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="receipt-foot">Recorded on a public ledger · example contract</div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface WayRow { title: string; line: string; href: string; note: { value: string; ccy: string; serial: string; motif: 'baobab' | 'rays' | 'waves' | 'hex'; ink: string } }

const WAYS: WayRow[] = [
  { title: 'Exporters and importers', line: 'Protect the dollar side of every trade, from a single supplier invoice upwards.', href: '/hedger',
    note: { value: '100', ccy: '₵', serial: 'BFX 0100 GH', motif: 'baobab', ink: '#b5532f' } },
  { title: 'Treasuries', line: 'Manage the currency exposure across your balance sheet, not one payment at a time.', href: '/hedger',
    note: { value: '500', ccy: '₦', serial: 'BFX 0500 NG', motif: 'rays', ink: '#2f6a8f' } },
  { title: 'Underwriters', line: 'Earn premiums by backing protection that real businesses need.', href: '/liquidity-provider',
    note: { value: '1000', ccy: 'KSh', serial: 'BFX 1000 KE', motif: 'waves', ink: '#3f7a4a' } },
  { title: 'Partners', line: 'Offer currency protection inside your own product, with your own fees.', href: '/contact',
    note: { value: '200', ccy: 'R', serial: 'BFX 0200 ZA', motif: 'hex', ink: '#6a4a9a' } },
];

/** A fictional banknote: guilloche rosette, a motif, the value and SPECIMEN. Not any real note. */
function FakeNote({ value, ccy, serial, motif, ink }: WayRow['note']) {
  const rose: string[] = [];
  for (let k = 0; k < 12; k++) {
    const pts: string[] = [];
    for (let t = 0; t <= 360; t += 5) {
      const a = (t * Math.PI) / 180;
      const r = 30 + 8 * Math.sin(7 * a + k * 0.5);
      pts.push(`${(r * Math.cos(a + k * 0.1)).toFixed(1)},${(r * Math.sin(a + k * 0.1)).toFixed(1)}`);
    }
    rose.push(`M${pts.join(' L')} Z`);
  }
  const border: string[] = [];
  for (let x = 6; x <= 314; x += 6) border.push(`M${x} 8 q 3 -4 6 0`, `M${x} 172 q 3 4 6 0`);
  return (
    <svg className="way-note" viewBox="0 0 320 180" aria-hidden="true" style={{ color: ink }}>
      <rect x="0" y="0" width="320" height="180" rx="10" fill="#fbf6ef" />
      <g fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.7">{border.map((d, i) => <path key={i} d={d} />)}</g>
      <rect x="10" y="14" width="300" height="152" rx="6" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.5" />
      <g transform="translate(232 82)" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.55">{rose.map((d, i) => <path key={i} d={d} />)}</g>
      <g fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.8" transform="translate(40 40)">
        {motif === 'baobab' && (<>
          <path d="M40 100 C 42 72, 36 52, 44 40 C 48 34, 54 34, 58 40 C 66 52, 60 72, 62 100" />
          <path d="M44 42 C 32 32, 20 30, 10 34 M48 38 C 42 22, 32 14, 22 12 M54 38 C 60 22, 72 16, 84 16 M58 42 C 70 32, 84 30, 94 36" />
          {[[10, 30], [22, 10], [86, 14], [96, 34], [52, 6]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={8 + (i % 2) * 3} />)}
          <path d="M0 100 H 110" />
        </>)}
        {motif === 'rays' && (<>
          <circle cx="55" cy="55" r="22" />
          {Array.from({ length: 24 }).map((_, i) => { const a = (i / 24) * Math.PI * 2; return <path key={i} d={`M${55 + 26 * Math.cos(a)} ${55 + 26 * Math.sin(a)} L${55 + 44 * Math.cos(a)} ${55 + 44 * Math.sin(a)}`} />; })}
          <path d="M0 100 H 110" />
        </>)}
        {motif === 'waves' && Array.from({ length: 8 }).map((_, i) => (
          <path key={i} d={`M0 ${30 + i * 9} q 14 -10 28 0 t 28 0 t 28 0 t 28 0`} />
        ))}
        {motif === 'hex' && (<>
          {[[30, 30], [62, 30], [46, 58], [78, 58], [14, 58], [30, 86], [62, 86]].map(([x, y], i) => (
            <path key={i} d={`M${x - 14} ${y} l7 -12 h14 l7 12 l-7 12 h-14 z`} />
          ))}
        </>)}
      </g>
      <text x="22" y="34" fontFamily="ui-monospace, monospace" fontSize="9" letterSpacing="1.5" fill="currentColor">{serial}</text>
      <text x="22" y="160" fontFamily="ui-monospace, monospace" fontSize="7.5" letterSpacing="1.4" fill="currentColor" opacity="0.8">SPECIMEN · NOT LEGAL TENDER</text>
      <text x="300" y="158" textAnchor="end" fontFamily="Georgia, 'Times New Roman', serif" fontSize="40" fill="currentColor">{ccy}{value}</text>
    </svg>
  );
}

/** Who BlockFinaX is for, as hover rows: the hovered row turns blue and its note slides in. */
function WhoSection() {
  const [active, setActive] = useState<number | null>(null);
  return (
    <section className="who ways" id="who">
      <Guilloche />
      <div className="wrap">
        <div className="assets-head">
          <h2>Built for the people who feel the rate.</h2>
          <p>Anyone whose costs move when a currency moves, and anyone with capital to put to work.</p>
        </div>
      </div>
      <div className="way-list" onMouseLeave={() => setActive(null)}>
        {WAYS.map((w, i) => (
          <Link
            key={w.title}
            href={w.href}
            className={`way-row${active === i ? ' on' : ''}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <span className="wrap way-in">
              <span className="way-media"><FakeNote {...w.note} /></span>
              <span className="way-title">{w.title}</span>
              <span className="way-line">{w.line}</span>
              <span className="way-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 7l5 5-5 5" /></svg>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* Circle-shaped icon glyphs sitting inside the persona cards.
   Single-stroke, currentColor, on a hairline outer ring. */

// ── Request cards / underwriting CTAs ────────────────────────────────────
// Two contrasting cards in the shape of Circle's "Partner with Circle" +
// "Build with Circle" pair. Left: light tint, dark type. Right: near-black
// with white type. Both target buyers/writers who can't find a fit in the
// open marketplace and want to work with us directly.


// ── Currencies we cover / flag row ───────────────────────────────────────
// Six emerging-market currencies with their circular flags, laid out as a
// horizontal row (single row on desktop, wrapping grid on mobile).

const CURRENCIES: Array<{ code: string; name: string; country: string }> = [
  { code: 'NGN', name: 'Naira',    country: 'Nigeria' },
  { code: 'GHS', name: 'Cedi',     country: 'Ghana' },
  { code: 'TZS', name: 'Shilling', country: 'Tanzania' },
  { code: 'ETB', name: 'Birr',     country: 'Ethiopia' },
  { code: 'ZAR', name: 'Rand',     country: 'South Africa' },
  { code: 'UGX', name: 'Shilling', country: 'Uganda' },
];

function CurrenciesSection() {
  return (
    <section className="cur" id="currencies">
      <div className="wrap">
        <div className="assets-head">
          <h2>Currencies we underwrite.</h2>
          <p>A few of the emerging-market pairs we cover today. If you need a pair that isn&apos;t in this list, request a quote and we&apos;ll structure it.</p>
        </div>
        <div className="cur-row">
          {CURRENCIES.map((c) => (
            <div className="cur-item" key={c.code}>
              <div className="cur-flag"><FlagSvg code={c.code} /></div>
              <div className="cur-lbl">
                <div className="cur-code">{c.code}</div>
                <div className="cur-country">{c.country}</div>
              </div>
            </div>
          ))}
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
            <Link href="/hedge" className="acard-cta">
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
            <Link href="/hedge" className="acard-cta">
              Underwrite <span className="arrow">→</span>
            </Link>
          </article>

          <article className="acard t-indigo">
            <h3>Predict the move</h3>
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
              <text className="lbl t" x="34" y="40">Yes</text>
              <text className="lbl" x="34" y="162">No</text>
              <text className="lbl" x="138" y="184">Strike</text>
            </svg>
            <p>Buy Yes or No shares on where a rate is headed.</p>
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

// ── Understand currency risk: learning and community ─────────────────────

/** A rough outline of Africa in a 100 x 100 box, for the dotted map. */
const AFRICA: [number, number][] = [
  [30, 8], [42, 4], [55, 6], [64, 9], [70, 14], [74, 22], [78, 30], [86, 34], [94, 36], [90, 44], [82, 52], [78, 60],
  [74, 70], [68, 80], [62, 88], [56, 94], [50, 96], [46, 92], [44, 84], [42, 74], [40, 64], [36, 56], [30, 52], [22, 50],
  [14, 46], [8, 40], [6, 32], [10, 24], [16, 16], [22, 11],
];
function inAfrica(x: number, y: number) {
  let inside = false;
  for (let i = 0, j = AFRICA.length - 1; i < AFRICA.length; j = i++) {
    const [xi, yi] = AFRICA[i], [xj, yj] = AFRICA[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const AFRICA_DOTS: [number, number][] = [];
for (let y = 2; y < 98; y += 3.2) for (let x = 2; x < 98; x += 3.2) if (inAfrica(x, y)) AFRICA_DOTS.push([x, y]);

/**
 * A fictional banknote (engraved baobab, rosette, cedi sign, SPECIMEN), a rate chart over
 * a dotted Africa, and the BlockFinaX badge. Not any real currency's design.
 */
function CurrencyArt() {
  const rose: string[] = [];
  for (let k = 0; k < 14; k++) {
    const pts: string[] = [];
    for (let t = 0; t <= 360; t += 4) {
      const a = (t * Math.PI) / 180;
      const r = 34 + 9 * Math.sin(6 * a + k * 0.45);
      pts.push(`${(r * Math.cos(a + k * 0.12)).toFixed(1)},${(r * Math.sin(a + k * 0.12)).toFixed(1)}`);
    }
    rose.push(`M${pts.join(' L')} Z`);
  }
  const candles = [[0, 4], [1, 6], [2, 3], [3, 9], [4, 12], [5, 10], [6, 16], [7, 20], [8, 18], [9, 26]];
  return (
    <svg className="learn-art" viewBox="0 0 560 420" role="img" aria-label="A fictional BlockFinaX banknote beside a rate chart over Africa">
      <defs>
        <clipPath id="note-clip"><circle cx="190" cy="200" r="150" /></clipPath>
        <clipPath id="chart-clip"><circle cx="370" cy="215" r="145" /></clipPath>
        <pattern id="note-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="0.6" opacity="0.25" />
        </pattern>
      </defs>

      {/* The chart circle, behind */}
      <g clipPath="url(#chart-clip)">
        <circle cx="370" cy="215" r="145" className="art-chart-bg" />
        {AFRICA_DOTS.map(([x, y], i) => <circle key={i} cx={318 + x * 1.95} cy={112 + y * 1.95} r="1.5" className="art-dot" />)}
        <line x1="225" x2="515" y1="210" y2="210" className="art-cap" />
        {candles.map(([i, h]) => (
          <rect key={i} x={330 + i * 16} y={300 - h * 6} width="9" height={14 + (i % 3) * 6} rx="1.5" className="art-candle" />
        ))}
        <path d="M300 300 C 340 290, 360 270, 390 250 S 450 170, 500 150" className="art-rate" />
      </g>

      {/* The banknote circle, in front */}
      <g clipPath="url(#note-clip)" className="art-note">
        <circle cx="190" cy="200" r="150" className="art-note-bg" />
        <rect x="40" y="50" width="300" height="300" fill="url(#note-hatch)" />
        <g transform="translate(250 130)" className="art-rose">{rose.map((d, i) => <path key={i} d={d} />)}</g>
        {/* Baobab */}
        <g className="art-ink" transform="translate(95 150)">
          <path d="M38 150 C 40 110, 34 80, 42 60 C 46 52, 54 52, 58 60 C 66 80, 60 110, 62 150 Z" />
          <path d="M42 62 C 30 50, 18 48, 8 52 M46 58 C 40 40, 30 30, 20 28 M54 58 C 60 40, 72 32, 84 32 M58 62 C 70 52, 84 50, 94 56" fill="none" strokeWidth="2" />
          {[[8, 46], [20, 24], [86, 28], [96, 50], [50, 18], [34, 34], [68, 30]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={10 + (i % 3) * 3} fill="none" strokeWidth="1" />)}
          <path d="M-20 150 H 140" fill="none" strokeWidth="1" />
          <path d="M-20 158 Q 30 150, 60 158 T 140 156" fill="none" strokeWidth="0.8" />
        </g>
        <text x="92" y="100" className="art-serial">BFX 2026 0100</text>
        <text x="92" y="118" className="art-specimen">SPECIMEN · NOT LEGAL TENDER</text>
        <text x="62" y="305" className="art-value">₵100</text>
        <circle cx="190" cy="200" r="148" fill="none" className="art-rim" />
      </g>

      {/* The connecting line and badge */}
      <path d="M0 120 C 120 100, 200 120, 250 160 S 420 330, 560 280" className="art-thread" />
      <circle cx="250" cy="160" r="5" className="art-thread-dot" />
      <g transform="translate(300 335)">
        <image href={logoPath} x="-46" y="-46" width="92" height="92" />
      </g>
    </svg>
  );
}

function LearnSection() {
  return (
    <section className="learn" id="learn">
      <div className="wrap">
        <div className="learn-head">
          <h2>Understand <span className="accent">currency risk</span></h2>
          <div className="learn-dots" aria-hidden="true" />
        </div>
        <div className="learn-grid">
          <CurrencyArt />
          <div className="learn-copy">
            <h3>Notes on the markets we cover</h3>
            <p>
              Our blog brings together worked examples and market notes on the naira, the cedi, the shilling and the other
              currencies we cover. It is written for business owners and finance teams, so you can see your exposure and decide
              how to manage it, with or without us.
            </p>
            <div className="learn-ctas">
              <Link href="/blog" className="btn btn-primary">Read the blog <span className="arrow">→</span></Link>
              <a href="https://www.linkedin.com/company/blockfinax/" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Follow us on LinkedIn <span className="arrow">→</span></a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


// ── Book-a-call cushion ─────────────────────────────────────────────────
// Big brand-accent panel sitting between the tail CTA and the footer, in
// the shape of a Rift/Vercel-style "Schedule" cushion. Solid accent fill,
// subtle grid overlay, one primary + one secondary CTA.

function BookCallCushion() {
  return (
    <section className="cushion" aria-labelledby="cushion-title">
      <div className="wrap">
        <div className="cushion-card">
          <div className="cushion-grid" aria-hidden="true" />
          <div className="cushion-body">
            <div className="cushion-tag">Schedule</div>
            <h2 id="cushion-title" className="cushion-h">Book a call.</h2>
            <p className="cushion-sub">
              15 minutes. We walk you through BlockFinaX and answer your questions.
            </p>
            <div className="cushion-actions">
              <a
                href="https://calendly.com/anthonykumako8/30min"
                target="_blank"
                rel="noopener noreferrer"
                className="cushion-btn primary"
              >
                Book a call <span className="arrow" aria-hidden="true">→</span>
              </a>
              <Link href="/contact" className="cushion-btn ghost">
                Contact us <span className="arrow" aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
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
              FX risk solutions for emerging markets. Hedge currency risk, or
              underwrite it to earn premiums.
            </p>
          </div>
          <div className="foot-cols">
            <div className="foot-col">
              <h5>Product</h5>
              <Link href="/apply">Request access</Link>
              <Link href="/hedger">For buyers</Link>
              <Link href="/liquidity-provider">For capital partners</Link>
            </div>
            <div className="foot-col">
              <h5>Resources</h5>
              <Link href="/about">About</Link>
              <Link href="/faq">FAQ</Link>
              <Link href="/blog">Blog</Link>
              <Link href="/contact">Contact</Link>
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
      <PillarsSection />
      <WhoSection />
      <UseSection theme={theme} />
      <TrustSection />
      <CurrenciesSection />
      <SignalSection />
      <LearnSection />
      <BookCallCushion />
      <Footer />
    </div>
  );
}


// ── Audience pages: short, one idea per section ─────────────────────────

interface AudienceCopy {
  eyebrow: string;
  title: [string, string];
  lede: string;
  primary: { label: string; href: string };
  steps: { t: string; d: string }[];
  points: { t: string; d: string }[];
  pointsTitle: string;
  note?: { t: string; d: string };
  faqs: { q: string; a: string }[];
  close: string;
}

const HEDGERS: AudienceCopy = {
  eyebrow: 'For businesses',
  title: ['Protect your', 'margin'],
  lede: 'When you pay or earn in another currency, a move in the rate can erase your profit. BlockFinaX lets you set the worst case in advance, for a known cost.',
  primary: { label: 'Launch App', href: '/hedge' },
  steps: [
    { t: 'Choose your cover', d: 'The currency, the amount, the end date and the move that worries you.' },
    { t: 'Pay once', d: 'One premium in USDC, shown in full before you approve. No credit line, no further calls.' },
    { t: 'Get paid if it moves', d: 'If the rate passes your strike at expiry, you receive the difference, up to your cap.' },
  ],
  pointsTitle: 'Why businesses use it',
  points: [
    { t: 'A known cost', d: 'The premium is the most protection can cost you.' },
    { t: 'Keep the upside', d: 'If the rate moves in your favour, you simply buy at the better rate.' },
    { t: 'Small amounts welcome', d: 'Protect a single supplier invoice, not only large contracts.' },
  ],
  faqs: [
    { q: 'Who is it for?', a: 'Importers, exporters and treasury teams with costs or revenue in another currency.' },
    { q: 'How is the rate decided?', a: 'At expiry, the contract settles against an agreed reference rate from its oracle operators, by rules written in code.' },
    { q: 'Do I need crypto experience?', a: 'No. You sign in with email or Google and approve with a passkey. Network fees are covered.' },
  ],
  close: 'Ready to protect a payment?',
};

const UNDERWRITERS: AudienceCopy = {
  eyebrow: 'For capital partners',
  title: ['Earn from', 'currency risk'],
  lede: 'Businesses pay premiums to protect their payments. As an underwriter, your USDC backs that protection and earns those premiums.',
  primary: { label: 'Launch App', href: '/hedge' },
  steps: [
    { t: 'Add USDC to a pool', d: 'Each pool covers one currency and one direction, so you know exactly what you back.' },
    { t: 'Earn at every sale', d: 'When protection is sold from your money, you receive your share of the premium straight away.' },
    { t: 'Withdraw what is free', d: 'Money not set aside for running cover can be withdrawn whenever you like.' },
  ],
  pointsTitle: 'What you control',
  points: [
    { t: 'Which risk', d: 'Choose the currency, the direction and the terms you back.' },
    { t: 'How long', d: 'Set the longest cover your money backs, or stop backing new sales at any time.' },
    { t: 'Fully reserved', d: 'The most each contract can pay is set aside when it is sold, never more than you put in.' },
  ],
  note: { t: 'The risk you take', d: 'If a covered rate moves past the strike, part of your reserve pays the business, up to the most that cover can pay. Only commit money you can leave in a pool until the cover it backs ends.' },
  faqs: [
    { q: 'Who is it for?', a: 'Funds, treasuries and individuals with USDC who want returns tied to real economic risk.' },
    { q: 'Where do returns come from?', a: 'Only from premiums businesses pay for protection, never from new deposits.' },
    { q: 'Can I lose money?', a: 'Yes, when covered rates move past strikes. Your loss on any contract is capped at what was reserved for it.' },
  ],
  close: 'Ready to put your USDC to work?',
};

function AudiencePage({ copy }: { copy: AudienceCopy }) {
  useGeistFont();
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => { setTheme(readStoredTheme()); window.scrollTo(0, 0); }, []);
  const toggleTheme = () => setTheme((t) => {
    const next: Theme = t === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    return next;
  });
  return (
    <div className="bfx-landing" data-theme={theme}>
      <TopNav theme={theme} onToggleTheme={toggleTheme} />
      <section className="aud-hero">
        <Guilloche />
        <div className="wrap">
          <div className="aud-eyebrow">{copy.eyebrow}</div>
          <h1 className="aud-title">{copy.title[0]} <span className="accent">{copy.title[1]}</span></h1>
          <p className="aud-lede">{copy.lede}</p>
          <div className="hero-ctas">
            <Link href={copy.primary.href} className="btn btn-primary">{copy.primary.label} <span className="arrow">→</span></Link>
            <Link href="/contact" className="btn btn-ghost">Talk to us</Link>
          </div>
        </div>
      </section>
      <section className="aud-section">
        <div className="wrap">
          <h2 className="aud-h2">How it works</h2>
          <ol className="aud-steps">
            {copy.steps.map((s, i) => (
              <li key={s.t}><span className="aud-n">{String(i + 1).padStart(2, '0')}</span><h3>{s.t}</h3><p>{s.d}</p></li>
            ))}
          </ol>
        </div>
      </section>
      <section className="aud-section">
        <div className="wrap">
          <h2 className="aud-h2">{copy.pointsTitle}</h2>
          <div className="aud-points">
            {copy.points.map((p) => <div key={p.t} className="aud-point"><h3>{p.t}</h3><p>{p.d}</p></div>)}
          </div>
          {copy.note && <div className="aud-note"><b>{copy.note.t}.</b> {copy.note.d}</div>}
        </div>
      </section>
      <section className="aud-section">
        <div className="wrap">
          <h2 className="aud-h2">Questions</h2>
          <div className="aud-faqs">
            {copy.faqs.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </div>
        </div>
      </section>
      <section className="tail">
        <div className="wrap">
          <h2>{copy.close}</h2>
          <div className="hero-ctas">
            <Link href={copy.primary.href} className="btn btn-primary">{copy.primary.label} <span className="arrow">→</span></Link>
            <Link href="/contact" className="btn btn-ghost">Talk to us</Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}

export function HedgersPage() { return <AudiencePage copy={HEDGERS} />; }
export function UnderwritersPage() { return <AudiencePage copy={UNDERWRITERS} />; }


// ── About ───────────────────────────────────────────────────────────────

const APPROACH = [
  { t: 'A protocol, not a counterparty', d: 'BlockFinaX connects businesses that need protection with underwriters who provide it. We build the pricing, the records and the settlement; underwriters carry the risk and earn the premiums.' },
  { t: 'Simple to use', d: 'Sign in with email, approve with a passkey and pay in USDC. No credit line, no dealer and no network fees to manage.' },
];

export function AboutPage() {
  useGeistFont();
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => { setTheme(readStoredTheme()); window.scrollTo(0, 0); }, []);
  const toggleTheme = () => setTheme((t) => {
    const next: Theme = t === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    return next;
  });
  return (
    <div className="bfx-landing" data-theme={theme}>
      <TopNav theme={theme} onToggleTheme={toggleTheme} />
      <section className="aud-hero">
        <Guilloche />
        <div className="wrap">
          <div className="aud-eyebrow">About BlockFinaX</div>
          <h1 className="aud-title">FX risk solutions for <span className="accent">emerging markets</span></h1>
          <div className="about-why">
            <p>
              Businesses and investors make commitments today whose costs and returns can change tomorrow. An exchange-rate
              move can make a supplier payment more expensive, increase the burden of foreign-currency debt or reduce the value
              of an investment.
            </p>
            <p>
              Protection lets people make those commitments with confidence. Yet the tools to manage this risk remain out of
              reach for many. <strong>BlockFinaX exists to make that protection accessible.</strong>
            </p>
          </div>
        </div>
      </section>
      <section className="aud-section">
        <div className="wrap">
          <h2 className="aud-h2">How we work</h2>
          <div className="about-approach">
            {APPROACH.map((a) => <div key={a.t}><h3>{a.t}</h3><p>{a.d}</p></div>)}
          </div>
        </div>
      </section>
      <section className="tail">
        <div className="wrap">
          <h2>Work with us.</h2>
          <p>Businesses, underwriters, partners and development institutions: we would like to hear from you.</p>
          <div className="hero-ctas">
            <Link href="/contact" className="btn btn-primary">Contact us <span className="arrow">→</span></Link>
            <Link href="/hedge" className="btn btn-ghost">Launch App</Link>
          </div>
        </div>
      </section>
      <Footer />
    </div>
  );
}
