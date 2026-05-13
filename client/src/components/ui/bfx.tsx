/**
 * bfx.tsx — BlockFinaX 2026 redesign primitives
 *
 * Built on top of shadcn/ui + Tailwind, these are the small reusable bits
 * the redesigned pages compose with: Pill, Dot, Sparkline, AssetGlyph,
 * SectionHd, and the BfxMark logo.
 */

import { type ReactNode, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// ── Brand mark (chevron-shield, two-tone) ─────────────────────────────
export function BfxMark({
  size = 28,
  className = '',
  primary = 'currentColor',
  accent,
  style = {},
}: {
  size?: number;
  className?: string;
  primary?: string;
  accent?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      style={style}
      aria-hidden
    >
      <path d="M4 4 L16 16 L4 28 L4 18 L10 12 L4 6 Z" fill={primary} />
      <path
        d="M28 4 L16 16 L28 28 L28 18 L22 12 L28 6 Z"
        fill={accent || 'hsl(217 91% 60%)'}
      />
    </svg>
  );
}

// ── Pill (status / category badge) ────────────────────────────────────
type PillTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'dark'
  | 'live';

const PILL_TONES: Record<PillTone, string> = {
  neutral:
    'bg-muted text-foreground/80 border border-border/60',
  primary:
    'bg-primary/10 text-primary border border-primary/20',
  success:
    'bg-emerald-100/70 text-emerald-700 border border-emerald-200/80 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
  warning:
    'bg-amber-100/70 text-amber-800 border border-amber-200/80 dark:bg-amber-400/10 dark:text-amber-300 dark:border-amber-400/20',
  danger:
    'bg-red-100/70 text-red-700 border border-red-200/80 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/20',
  dark:
    'bg-white/10 text-white border border-white/15',
  live:
    'bg-emerald-500/15 text-emerald-600 border border-emerald-500/20 dark:text-emerald-300',
};

export function Pill({
  tone = 'neutral',
  children,
  className = '',
  uppercase = true,
}: {
  tone?: PillTone;
  children: ReactNode;
  className?: string;
  uppercase?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium tracking-wide leading-tight',
        uppercase && 'uppercase',
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Dot (status indicator) ────────────────────────────────────────────
export function Dot({
  className = '',
  size = 6,
  pulse = false,
  style = {},
}: {
  className?: string;
  size?: number;
  pulse?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block rounded-full', pulse && 'animate-pulse', className)}
      style={{
        width: size,
        height: size,
        boxShadow: '0 0 0 3px currentColor',
        opacity: 1,
        backgroundColor: 'currentColor',
        ...style,
      }}
    />
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────
export function Sparkline({
  data,
  width = 80,
  height = 24,
  stroke = 'currentColor',
  fill = false,
  className = '',
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
  className?: string;
}) {
  if (!data || data.length < 2) {
    return <svg width={width} height={height} className={className} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * height,
  ]);
  const d = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ');
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block', className)}
      aria-hidden
    >
      {fill && <path d={area} fill={stroke} fillOpacity="0.12" />}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Asset glyph (colored token mark) ───────────────────────────────────
const ASSET_COLORS: Record<string, [string, string]> = {
  ETH: ['#627EEA', '#fff'],
  USDC: ['#2775CA', '#fff'],
  USDT: ['#26A17B', '#fff'],
  BNB: ['#F3BA2F', '#0E1116'],
  LSK: ['#0D4EA6', '#fff'],
  BTC: ['#F7931A', '#fff'],
  GHS: ['#10B981', '#fff'],
  NGN: ['#0E1116', '#fff'],
  ZAR: ['#C5532E', '#fff'],
  XAU: ['#C8841E', '#fff'],
  KES: ['#155E3F', '#fff'],
  EUR: ['#1F3A5F', '#fff'],
  USD: ['#1F3866', '#fff'],
};

export function AssetGlyph({
  symbol,
  size = 36,
  className = '',
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const upper = (symbol || '').toUpperCase();
  const [bg, fg] = ASSET_COLORS[upper] || ['#1F3866', '#fff'];
  return (
    <span
      className={cn('inline-flex items-center justify-center rounded-full font-mono-data shrink-0', className)}
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: size * 0.3,
        fontWeight: 600,
        letterSpacing: '-0.02em',
      }}
      aria-hidden
    >
      {upper.slice(0, 3)}
    </span>
  );
}

// ── Section header (in-screen) ─────────────────────────────────────────
export function SectionHd({
  title,
  action,
  dark = false,
  className = '',
}: {
  title: ReactNode;
  action?: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between mb-2.5', className)}>
      <h3
        className={cn(
          'text-[13px] font-semibold tracking-tight',
          dark ? 'text-white' : 'text-foreground',
        )}
      >
        {title}
      </h3>
      {action}
    </div>
  );
}

// ── Stat (label/value pair, mono numeric) ──────────────────────────────
export function Stat({
  label,
  value,
  sub,
  dark = false,
  className = '',
  valueClassName = '',
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  dark?: boolean;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <span
        className={cn(
          'text-[10px] uppercase tracking-wider font-medium',
          dark ? 'text-white/60' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono-data text-sm font-semibold',
          dark ? 'text-white' : 'text-foreground',
          valueClassName,
        )}
      >
        {value}
      </span>
      {sub && (
        <span
          className={cn(
            'text-[11px]',
            dark ? 'text-white/50' : 'text-muted-foreground',
          )}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Quick-action button (icon over label) ──────────────────────────────
type QuickActionTone = 'primary' | 'amber' | 'emerald' | 'violet';

const QUICK_ACTION_TONES: Record<QuickActionTone, { bg: string; bgHover: string; text: string }> = {
  primary: {
    bg: 'bg-primary/10',
    bgHover: 'group-hover:bg-primary/15',
    text: 'text-primary',
  },
  amber: {
    bg: 'bg-amber-500/10',
    bgHover: 'group-hover:bg-amber-500/15',
    text: 'text-amber-600 dark:text-amber-400',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    bgHover: 'group-hover:bg-emerald-500/15',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  violet: {
    bg: 'bg-violet-500/10',
    bgHover: 'group-hover:bg-violet-500/15',
    text: 'text-violet-600 dark:text-violet-400',
  },
};

export function QuickAction({
  icon,
  label,
  onClick,
  dark = false,
  disabled = false,
  tone = 'primary',
  className = '',
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  dark?: boolean;
  disabled?: boolean;
  tone?: QuickActionTone;
  className?: string;
}) {
  const t = QUICK_ACTION_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border transition-all',
        dark
          ? 'bg-white/5 border-white/10 text-white hover:bg-white/10'
          : 'bg-card border-border hover:border-primary/40 hover:bg-primary/[0.03] active:scale-[0.98]',
        disabled && 'opacity-40 pointer-events-none',
        className,
      )}
    >
      <span
        className={cn(
          'h-9 w-9 rounded-full inline-flex items-center justify-center transition-colors',
          dark
            ? 'bg-white/10 text-white group-hover:bg-white/15'
            : cn(t.bg, t.text, t.bgHover),
        )}
      >
        {icon}
      </span>
      <span className={cn('text-[11px] font-medium', dark ? 'text-white/90' : 'text-foreground')}>
        {label}
      </span>
    </button>
  );
}

// ── Formatters ─────────────────────────────────────────────────────────
export function fmtUsd(n: number, opts: { compact?: boolean } = {}): string {
  const { compact = false } = opts;
  if (!isFinite(n)) return '$0.00';
  if (compact && Math.abs(n) >= 1000) {
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    return `$${(n / 1e3).toFixed(1)}K`;
  }
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function fmtNum(n: number, decimals = 4): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function shortAddr(addr?: string | null): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
