/**
 * Product walkthrough: a spotlight on one part of the screen at a time, with a short card.
 * Shown once per user after their first sign-in, and again from Account ("Take the tour").
 * Steps point at elements by [data-tour] (or a class); when a target is not on screen (for
 * example a menu item that sits under More on a phone) the card shows in the middle instead.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { Role } from './workspace';

interface Step { target?: string; title: string; body: string }

const STEPS: Record<Role, Step[]> = {
  hedger: [
    { title: 'Welcome to BlockFinaX', body: 'Protect the money you pay or receive in another currency. You choose how much, for how long and from which rate; if the rate moves against you, you get paid in USDC. This is the demo, so everything uses test USDC.' },
    { target: '[data-tour="roles"]', title: 'Hedger or underwriter', body: 'As a hedger you buy protection. As an underwriter you put USDC into pools and earn the premiums hedgers pay. Switch here at any time.' },
    { target: '[data-tour="balance"]', title: 'Your balance', body: 'Your USDC, in one place. Tap it to open your wallet. Network fees are covered, so USDC is all you ever need.' },
    { target: '[data-tour="wallet"], .bx-balance-pill.bx-show-sm', title: 'Add money', body: 'In Wallet, tap Deposit to get your deposit address, or get free test USDC while you try things out.' },
    { target: '[data-tour="h-protect"]', title: 'Markets', body: 'Every currency you can protect, today\'s rate and its price. Choose one and price your protection on the same page.' },
    { target: '[data-tour="protect"]', title: 'Protect an exposure', body: 'Answer four questions: which currency, how much, when, and which move worries you. You see the full cost before you approve with your passkey.' },
    { target: '[data-tour="h-protections"]', title: 'My protections', body: 'Follow each protection until it ends. If the rate passed your strike at expiry, your payout is ready to claim here.' },
    { target: '.bx-agent-fab', title: 'Ask BlockFinaX', body: 'Questions about a quote, a currency or how payouts work? Ask here at any time.' },
    { title: 'You are ready', body: 'Start with free test USDC in Wallet, then protect your first exposure. You can replay this tour from Account.' },
  ],
  underwriter: [
    { title: 'Earn as an underwriter', body: 'Put USDC into currency pools and earn the premiums businesses pay for protection. You choose the currency, the direction and the terms you back. This is the demo, so everything uses test USDC.' },
    { target: '[data-tour="roles"]', title: 'Hedger or underwriter', body: 'Switch back to Hedger at any time to buy protection yourself.' },
    { target: '[data-tour="create-pool"]', title: 'Create a pool', body: 'Pick a currency and direction, the durations you offer and how far from today\'s rate protection may start. Your USDC backs the protection sold from it.' },
    { target: '[data-tour="u-pools"]', title: 'My pools', body: 'Add liquidity to your pools or to open pools, and see what each one has earned.' },
    { target: '[data-tour="u-risk"]', title: 'Risk and exposure', body: 'See how much of your USDC is set aside for open protections and what you could pay at most.' },
    { target: '[data-tour="u-withdraw"]', title: 'Withdraw capital', body: 'USDC not set aside for open protections can be withdrawn whenever you like.' },
    { title: 'You are ready', body: 'Get free test USDC in Wallet, then create a pool or add liquidity. You can replay this tour from Account.' },
  ],
};

const seenKey = (userId: number | string) => `bfx:tour:v1:${userId}`;

/** The first matching element that is actually on screen. */
function visible(selector?: string): HTMLElement | null {
  if (!selector) return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** Ask the tour to start from anywhere (Account's "Take the tour"). */
export function startTour() {
  window.dispatchEvent(new CustomEvent('bfx:tour'));
}

export function ProductTour({ role, userId }: { role: Role; userId?: number | string }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const steps = STEPS[role];
  const step = steps[Math.min(i, steps.length - 1)];

  // First sign-in: show once per user.
  useEffect(() => {
    if (userId === undefined) return;
    let seen = false;
    try { seen = localStorage.getItem(seenKey(userId)) === '1'; } catch { /* storage blocked: show it */ }
    if (seen) return;
    const t = setTimeout(() => { setI(0); setOpen(true); }, 900);
    return () => clearTimeout(t);
  }, [userId]);

  useEffect(() => {
    const replay = () => { setI(0); setOpen(true); };
    window.addEventListener('bfx:tour', replay);
    return () => window.removeEventListener('bfx:tour', replay);
  }, []);

  // A role switch mid-tour starts that role's tour from the top.
  useEffect(() => { setI(0); }, [role]);

  const close = useCallback(() => {
    setOpen(false);
    if (userId !== undefined) try { localStorage.setItem(seenKey(userId), '1'); } catch { /* per-viewer convenience */ }
  }, [userId]);

  const measure = useCallback(() => {
    const el = visible(step?.target);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, close, steps.length]);

  if (!open || !step) return null;
  const last = i === steps.length - 1;
  const pad = 6;

  // Place the card below the target, or above it when there is no room; clamp to the screen.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(360, vw - 32);
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 14;
    const fitsBelow = below + 220 < vh;
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - cardW / 2, vw - cardW - 16));
    cardStyle = fitsBelow ? { top: below, left, width: cardW } : { bottom: vh - rect.top + 14, left, width: cardW };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: cardW };
  }

  return (
    <div className="bx-tour" role="dialog" aria-modal="true" aria-label="Product tour">
      {rect ? (
        <div className="bx-tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="bx-tour-dim" />
      )}
      <div className="bx-tour-card" style={cardStyle}>
        <div className="bx-tour-step">{i + 1} of {steps.length}</div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="bx-tour-dots" aria-hidden="true">
          {steps.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}
        </div>
        <div className="bx-tour-actions">
          <button className="bx-tour-skip" onClick={close}>{last ? '' : 'Skip tour'}</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {i > 0 && <button className="bx-btn ghost" onClick={() => setI(i - 1)}>Back</button>}
            <button className="bx-btn" onClick={() => (last ? close() : setI(i + 1))}>{last ? 'Get started' : i === 0 ? 'Show me around' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
