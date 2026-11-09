/** Building blocks for the BlockFinaX workspace. Styles live in workspace.css. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { explain } from './glossary';
import { Info, Loader2 } from 'lucide-react';
import { FlagSvg } from '@/components/app-glyphs';
import { ccyName, quoteCcy } from './shared';

export function Flag({ pair, large }: { pair: string; large?: boolean }) {
  return <span className={`bx-flag${large ? ' lg' : ''}`}><FlagSvg code={quoteCcy(pair)} /></span>;
}

// ── Hover explanations ────────────────────────────────────────────────────────

/**
 * A term with a plain-language explanation on hover, keyboard focus or tap. The bubble is
 * drawn in a portal inside the workspace root with fixed positioning, so scrolling tables
 * cannot clip it, and it inherits the light or dark theme.
 */
export function Term({ children, tip, label, plain }: { children: ReactNode; tip: string; label?: string; plain?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 90; // no room above: open underneath
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140), y: below ? r.bottom + 8 : r.top - 8, below });
  };
  const hide = () => setPos(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [pos]);
  const root = typeof document !== 'undefined' ? document.querySelector('.bx') : null;
  return (
    <span
      ref={ref} className={`bx-term${plain ? ' plain' : ''}`} tabIndex={0} aria-label={`${label ?? (typeof children === 'string' ? children : '')}: ${tip}`}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
      onClick={(e) => { e.stopPropagation(); if (pos) hide(); else show(); }}
    >
      {children}
      {pos && root && createPortal(
        <span role="tooltip" className={`bx-tip${pos.below ? ' below' : ''}`} style={{ left: pos.x, top: pos.y }}>{tip}</span>,
        root,
      )}
    </span>
  );
}

/**
 * A cover's name: the pair, then "Up cover" or "Down cover" a size smaller, with a plain
 * explanation of what it pays for on hover, focus or tap.
 */
export function CoverName({ pair, direction }: { pair: string; direction: 'up' | 'down' | 'both' }) {
  const kind = direction === 'down' ? 'Down cover' : direction === 'both' ? 'Up and Down cover' : 'Up cover';
  const name = ccyName(pair);
  const local = name.includes(' ') ? `the ${name}` : `the ${name.toLowerCase()}`;
  const up = `pays you if the dollar rises above your strike rate by the end date, meaning ${local} weakens. For dollars you have to pay.`;
  const down = `pays you if the dollar falls below your strike rate by the end date, meaning ${local} strengthens. For dollars you will receive.`;
  const tip = direction === 'down' ? `${kind} ${down}` : direction === 'both' ? `Up cover ${up} Down cover ${down}` : `${kind} ${up}`;
  return (
    <Term tip={tip} label={`${pair} ${kind}`} plain>
      <span className="bx-cover-name">{pair}<span className="bx-cover-kind">{kind}</span></span>
    </Term>
  );
}

/** "Ref.": the reference rate, never called spot (it is a guide, not a dealing rate). */
export function RefRate() {
  return (
    <Term tip="Reference rate: the market rate BlockFinaX uses to price and settle cover. It is a guide only, not a rate you can buy or sell currency at." label="Reference rate" plain>
      Ref.
    </Term>
  );
}

/** A label with its glossary explanation, when it has one. */
export function hint(label: string): ReactNode {
  const tip = explain(label);
  return tip ? <Term tip={tip}>{label}</Term> : label;
}

export function Sum({ l, v, total, good }: { l: ReactNode; v: ReactNode; total?: boolean; good?: boolean }) {
  return (
    <div className={`bx-sum${total ? ' total' : ''}`}>
      <span className="l">{typeof l === 'string' ? hint(l) : l}</span>
      <span className={`v${good ? ' up' : ''}`}>{v}</span>
    </div>
  );
}

export function Tag({ tone, children }: { tone: 'green' | 'blue' | 'grey' | 'amber'; children: ReactNode }) {
  return <span className={`bx-tag ${tone}`}>{children}</span>;
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button type="button" aria-label={label} aria-pressed={on} className={`bx-toggle${on ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Note({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return <div className={`bx-note${warn ? ' warn' : ''}`}><Info aria-hidden="true" /><span>{children}</span></div>;
}

export function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="bx-steps">
      {labels.map((l, i) => (
        <div key={l} style={{ display: 'contents' }}>
          {i > 0 && <span className="bx-step-line" />}
          <span className={`bx-step${i === current ? ' on' : i < current ? ' done' : ''}`}><span className="n">{i + 1}</span>{l}</span>
        </div>
      ))}
    </div>
  );
}

export function Spin() {
  return <Loader2 className="bx-spin" style={{ width: 16, height: 16 }} />;
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return <div className="bx-empty"><Spin /> {label}</div>;
}

// ── Asset class switch: FX or interest rates ─────────────────────────────────

export type AssetClass = 'fx' | 'ir';

/**
 * Interest-rate protection is hidden from the workspace for now (the oracle and pools keep
 * running on testnet). Set to true to bring back every interest-rate screen and switch.
 */
export const SHOW_INTEREST_RATES = false;
const ASSET_CLASS_KEY = 'bfx-asset-class';

function readAssetClass(): AssetClass {
  if (!SHOW_INTEREST_RATES) return 'fx';
  try { return localStorage.getItem(ASSET_CLASS_KEY) === 'ir' ? 'ir' : 'fx'; } catch { return 'fx'; }
}

/** The asset class last chosen anywhere in the workspace, remembered per browser. */
export function useAssetClass(): [AssetClass, (a: AssetClass) => void] {
  const [value, setValue] = useState<AssetClass>(readAssetClass);
  const set = (a: AssetClass) => {
    if (!SHOW_INTEREST_RATES) return;
    setValue(a);
    try { localStorage.setItem(ASSET_CLASS_KEY, a); } catch { /* storage unavailable */ }
  };
  return [value, set];
}

export function AssetClassTabs({ value, onChange, small }: { value: AssetClass; onChange: (a: AssetClass) => void; small?: boolean }) {
  if (!SHOW_INTEREST_RATES) return null;
  return (
    <div className={`bx-seg${small ? ' small' : ''}`} role="tablist" aria-label="Asset class" style={small ? { width: 'auto' } : { maxWidth: 360, marginBottom: 16 }}>
      <button role="tab" aria-selected={value === 'fx'} className={value === 'fx' ? 'on' : ''} onClick={() => onChange('fx')}>FX</button>
      <button role="tab" aria-selected={value === 'ir'} className={value === 'ir' ? 'on' : ''} onClick={() => onChange('ir')}>Interest rates</button>
    </div>
  );
}
