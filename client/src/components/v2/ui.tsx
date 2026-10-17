/** Building blocks for the BlockFinaX workspace. Styles live in workspace.css. */
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { FlagSvg } from '@/components/app-glyphs';
import { quoteCcy } from './shared';

export function StatCard({ label, value, sub, icon, tone, subTone }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: 'g' | 'a'; subTone?: 'up';
}) {
  return (
    <div className="bx-card bx-stat">
      <div>
        <div className="k">{label}</div>
        <div className="v">{value}</div>
        {sub ? <div className={`s${subTone ? ` ${subTone}` : ''}`}>{sub}</div> : null}
      </div>
      <div className={`ic${tone ? ` ${tone}` : ''}`}>{icon}</div>
    </div>
  );
}

export function Card({ title, action, children, className = '' }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`bx-card ${className}`}>
      {title ? <div className="bx-card-h"><h3>{title}</h3>{action}</div> : null}
      {children}
    </div>
  );
}

export function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="bx-steps">
      {labels.map((l, i) => (
        <div key={l} style={{ display: 'contents' }}>
          {i > 0 && <div className={`bx-step-line${i <= current ? ' done' : ''}`} />}
          <div className={`bx-step${i === current ? ' on' : i < current ? ' done' : ''}`}>
            <span className="n">{i + 1}</span>
            <span>{l}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Row({ l, v, total, good }: { l: ReactNode; v: ReactNode; total?: boolean; good?: boolean }) {
  return (
    <div className={`bx-row${total ? ' total' : ''}`}>
      <span className="l">{l}</span>
      <span className={`v${good ? ' good' : ''}`}>{v}</span>
    </div>
  );
}

export function Tag({ tone, children }: { tone: 'green' | 'amber' | 'grey' | 'blue'; children: ReactNode }) {
  return <span className={`bx-tag ${tone}`}>{children}</span>;
}

export function Ccy({ pair, children }: { pair: string; children?: ReactNode }) {
  return (
    <span className="bx-ccy">
      <span className="bx-flag"><FlagSvg code={quoteCcy(pair)} /></span>
      {children ?? quoteCcy(pair)}
    </span>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button type="button" className={`bx-toggle${on ? ' on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function Spin() {
  return <Loader2 className="bx-spin" style={{ width: 16, height: 16 }} />;
}

export function Loading({ label = 'Loading...' }: { label?: string }) {
  return <div className="bx-empty"><Spin /> {label}</div>;
}
