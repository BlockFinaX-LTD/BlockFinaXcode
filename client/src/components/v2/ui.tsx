/** Building blocks for the BlockFinaX workspace. Styles live in workspace.css. */
import { useState, type ReactNode } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { FlagSvg } from '@/components/app-glyphs';
import { quoteCcy } from './shared';

export function Flag({ pair, large }: { pair: string; large?: boolean }) {
  return <span className={`bx-flag${large ? ' lg' : ''}`}><FlagSvg code={quoteCcy(pair)} /></span>;
}

export function Sum({ l, v, total, good }: { l: ReactNode; v: ReactNode; total?: boolean; good?: boolean }) {
  return (
    <div className={`bx-sum${total ? ' total' : ''}`}>
      <span className="l">{l}</span>
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
