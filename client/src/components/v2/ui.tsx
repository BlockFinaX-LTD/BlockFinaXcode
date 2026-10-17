/** Building blocks for the BlockFinaX workspace. Styles live in workspace.css. */
import type { ReactNode } from 'react';
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
