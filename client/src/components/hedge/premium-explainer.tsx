/**
 * premium-explainer.tsx — what sets this pool's premium, and what moves it.
 *
 * A rate on its own invites the wrong conclusion. Someone who sees a pool
 * listed at 0.501% and is charged 0.4997% has no way to tell whether the price
 * moved for a reason, whether they were overcharged, or whether something is
 * broken. And the two pricing bases behave so differently that showing the
 * same bare number for both is close to misleading: on one pool the rate is a
 * promise that holds for the pool's whole life, on the other it is only true
 * for the next two minutes.
 *
 * So this says which basis a pool uses, in that pool's own live numbers, and
 * what each of them is doing to the price.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { fmtRate } from '@/lib/format-rate';
import type { PurchaseQuote } from '@/lib/purchase-quote';

export interface PremiumExplainerProps {
  open: boolean;
  onClose: () => void;
  /** The rate the creator set when they opened the pool. */
  storedRate: number;
  /** True when this pool prices at the moment of purchase. Immutable per pool. */
  dynamic: boolean;
  /** The live quote, when one has loaded. */
  quote?: PurchaseQuote | null;
  /** Set on a position already bought, so the holder sees what they actually paid. */
  paidRate?: number | null;
  underlying: string;
  strike: number;
  strikeAbove: boolean;
  createdAt?: Date | null;
  expiryDate: Date;
  /** Platform fee as a share of the premium, from chain. Null while unknown. */
  hedgerFeeRate?: number | null;
}

function Row({ head, children }: { head: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '11px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: '0 0 34%', fontSize: 12.5, color: 'var(--tx-2)', fontWeight: 600, lineHeight: 1.45 }}>{head}</div>
      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

function Fig({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: 'var(--mono)', color: 'var(--tx)', fontWeight: 600 }}>{children}</span>;
}

export function PremiumExplainer(props: PremiumExplainerProps) {
  const { open, onClose, storedRate, dynamic, quote, paidRate, strike, strikeAbove, createdAt, expiryDate, hedgerFeeRate } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // The sheet this opens from is itself position:fixed with a transform, which
  // makes it the containing block for anything fixed inside it. A dialog
  // rendered in place would be trapped in the sheet and clipped by it. Portal
  // into the themed shell rather than document.body, or the panel renders in
  // the wrong theme.
  const host =
    (typeof document !== 'undefined' && document.querySelector('.bfx-app')) ||
    (typeof document !== 'undefined' ? document.body : null);
  if (!host) return null;

  const b = quote?.breakdown;
  const liveRate = quote?.premiumRate ?? null;

  // How much of the pool's life has gone. Only knowable when the chain gave us
  // a creation time; without it the tenor is left out rather than guessed.
  const totalDays = createdAt ? (expiryDate.getTime() - createdAt.getTime()) / 86400000 : null;
  const daysLeft = b ? b.daysRemaining : Math.max(0, (expiryDate.getTime() - Date.now()) / 86400000);
  const dayWord = (d: number) => (d >= 1.5 ? Math.round(d) + ' days' : d >= 0.9 ? 'about a day' : 'hours');

  const spot = b?.spot ?? 0;
  const gapToStrike = spot > 0 && strike > 0 ? (spot - strike) / strike : null;

  const util = b ? b.utilisation : null;
  const utilMult = b ? b.utilisationMultiplier : null;

  /**
   * Is the payout side already winning?
   *
   * This decides which way time pushes the price, and the two directions are
   * opposite. Out of the money, less time is less room for the rate to reach
   * the strike, so cover gets cheaper. In the money, less time is less room for
   * the rate to come BACK, so the payout is closer to locked in and cover gets
   * dearer.
   *
   * Measured on a USD/GHS pool struck at 12.60 with a 13.20 cap: at spot 12.00
   * the rate falls 1.500% -> 0.075% over the last 30 days, and at spot 13.15 it
   * RISES 2.297% -> 3.251% over the same window. This panel used to state the
   * falling case as though it were the only one.
   */
  const inTheMoney = spot > 0 && strike > 0 ? (strikeAbove ? spot > strike : spot < strike) : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How this premium is set"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 120,
        background: 'color-mix(in oklab, var(--bg) 72%, transparent)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: 'min(86vh, 760px)', overflowY: 'auto',
          background: 'var(--bg-2)', border: '1px solid var(--border-2)',
          borderRadius: '18px 18px 0 0', padding: '18px clamp(16px, 4vw, 24px) 26px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--tx)' }}>
              How this premium is set
            </h3>
            <div
              style={{
                display: 'inline-block', marginTop: 7, padding: '3px 9px', borderRadius: 999,
                fontSize: 11, fontWeight: 600, letterSpacing: '0.01em',
                color: dynamic ? 'var(--amber)' : 'var(--tx-2)',
                background: 'var(--film-2)', border: '1px solid var(--border-2)',
              }}
            >
              {dynamic ? 'Priced at the moment you buy' : 'Fixed for the life of this pool'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ border: 'none', background: 'transparent', color: 'var(--tx-3)', cursor: 'pointer', padding: 6, display: 'inline-flex' }}
          >
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* The numbers first, because they are what the reader came from. */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
          <div style={{ flex: 1, padding: '11px 12px', borderRadius: 11, background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--tx-4)' }}>
              {dynamic ? 'Opening rate' : 'The rate'}
            </div>
            <div className="tnum" style={{ fontSize: 19, fontWeight: 700, color: 'var(--tx)', marginTop: 3 }}>{fmtRate(storedRate)}</div>
          </div>
          {/* Only when there is a second number to show. Opened from a market
              detail there is no amount yet, so no quote is being fetched and an
              ellipsis here read as "loading" forever. */}
          {dynamic && (paidRate != null || liveRate != null) && (
            <div style={{ flex: 1, padding: '11px 12px', borderRadius: 11, background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 10.5, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--tx-4)' }}>
                {paidRate != null ? 'You paid' : 'Right now'}
              </div>
              <div className="tnum" style={{ fontSize: 19, fontWeight: 700, color: 'var(--tx)', marginTop: 3 }}>
                {paidRate != null ? fmtRate(paidRate) : fmtRate(liveRate as number)}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          {!dynamic ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.62, margin: '0 0 10px' }}>
                The underwriter set {fmtRate(storedRate)} when they opened this pool, and it does not move.
                Whoever buys, and whenever they buy, pays that same share of whatever they cover.
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6, margin: '0 0 4px' }}>
                That cuts both ways, and it is worth knowing which way you are on.
                {totalDays && totalDays > 1 ? (
                  <>
                    {' '}This pool runs {Math.round(totalDays)} days and has {dayWord(daysLeft)} left.
                    Buying now costs the same as buying on the first day, for less time covered.
                  </>
                ) : (
                  <> Buying late in a pool's life costs the same as buying at the start, for less time covered.</>
                )}
                {' '}In exchange, the price cannot be moved against you by other buyers or by the rate drifting toward the strike.
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.62, margin: '0 0 10px' }}>
                The underwriter set {fmtRate(storedRate)} when they opened this pool. That is their opening
                view of the risk, and it anchors every price after it. From there the rate moves, and you are
                charged the price at the moment you buy rather than the opening one.
              </p>
              {/* The drivers only carry live figures once a quote exists, and a
                  quote needs an amount. Say so rather than showing three rows of
                  general prose and letting it look like the pool's own numbers. */}
              <p style={{ fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6, margin: '0 0 14px' }}>
                {b
                  ? 'Three things move it, and you can see all three below as they stand right now.'
                  : 'Three things move it. Enter an amount on the buy screen to see where this pool stands on each of them.'}
              </p>

              <Row head="Time left">
                {b ? (
                  <>
                    <Fig>{dayWord(daysLeft)}</Fig>
                    {totalDays && totalDays > 0 ? <> of the pool's {Math.round(totalDays)}.</> : '.'}{' '}
                    {inTheMoney
                      ? <>The rate is already past the strike, so less time means less room for it to come
                          back. The payout gets closer to settled and cover gets <strong>dearer</strong> as
                          expiry approaches.</>
                      : <>The rate has not reached the strike, so less time means less room for it to get
                          there. Cover gets <strong>cheaper</strong> as expiry approaches.</>}
                  </>
                ) : (
                  <>
                    Which way this pushes depends on where the rate sits. Short of the strike, less time
                    means less room to reach it and cover gets cheaper. Past the strike, less time means
                    less room to come back and cover gets dearer.
                  </>
                )}
              </Row>

              <Row head="Distance to the strike">
                {b && gapToStrike != null ? (
                  <>
                    The rate is <Fig>{spot.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Fig> and the
                    strike is <Fig>{strike.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Fig>,
                    so it sits <Fig>{Math.abs(gapToStrike * 100).toFixed(2)}%</Fig>{' '}
                    {gapToStrike >= 0 ? 'above' : 'below'} it.
                    {' '}This pool pays out if the rate finishes {strikeAbove ? 'above' : 'below'} the strike,
                    so the {strikeAbove ? 'closer the rate climbs toward' : 'closer the rate falls toward'} it,
                    the more likely a payout becomes and the more cover costs.
                  </>
                ) : (
                  <>
                    This pool pays out if the rate finishes {strikeAbove ? 'above' : 'below'} the strike. The nearer
                    the rate gets to it, the more likely a payout becomes and the more cover costs.
                  </>
                )}
              </Row>

              <Row head="How much of the pool is taken">
                {util != null ? (
                  <>
                    <Fig>{Math.round(util * 100)}%</Fig> of this pool's capacity is already covering
                    someone{utilMult != null && utilMult > 1.001 ? (
                      <>, which is adding <Fig>{((utilMult - 1) * 100).toFixed(1)}%</Fig> to the price.</>
                    ) : (
                      <>, which is barely affecting the price yet.</>
                    )}
                    {' '}The effect is deliberately slow at first and steep at the end, so early buyers are
                    hardly touched and the last of the capacity is rationed rather than sold cheap.
                  </>
                ) : (
                  <>
                    As a pool fills, the remaining capacity is priced higher. The effect is slow at first and
                    steep at the end, so the last of the cover is rationed rather than sold cheap.
                  </>
                )}
              </Row>

              {b?.floorApplied && (
                <Row head="A floor is holding">
                  This quote hit the pool's minimum premium. Without it a far out of the money quote would round
                  toward nothing, and cover that costs nothing is not cover.
                </Row>
              )}

              <div style={{ marginTop: 16, padding: '12px 13px', borderRadius: 11, background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-2)', marginBottom: 6 }}>What does not change</div>
                <p style={{ fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6, margin: 0 }}>
                  The underwriter's own view of the risk. Nothing here overrules the rate they set. The engine works
                  out the volatility that produces exactly their opening premium
                  {b ? <>, which for this pool is <Fig>{(b.sigmaStar * 100).toFixed(1)}%</Fig> a year,</> : ','}{' '}
                  then re-prices with that same volatility as time passes and the rate moves. A pool does not get
                  cheaper because a model disagrees with the underwriter. It changes because the time left and
                  the distance to the strike have changed, and by exactly as much as those two things are worth.
                </p>
              </div>

              {paidRate == null && (
                <p style={{ fontSize: 11.5, color: 'var(--tx-4)', lineHeight: 1.55, margin: '12px 0 0' }}>
                  The price you are shown is signed for your address alone and holds for 120 seconds. If it expires
                  while the transaction is being prepared, the purchase is refused rather than filled at a price you
                  did not agree to.
                </p>
              )}
            </>
          )}

          {paidRate != null && Math.abs(paidRate - storedRate) > 1e-7 && (
            <p style={{ fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6, margin: '14px 0 0' }}>
              You paid <Fig>{fmtRate(paidRate)}</Fig> against an opening rate of <Fig>{fmtRate(storedRate)}</Fig>.
              {paidRate < storedRate
                ? ' You bought below the opening rate, which is what the time already gone from this pool was worth.'
                : ' You bought above the opening rate, because the risk had grown by the time you bought.'}
            </p>
          )}

          {hedgerFeeRate != null && (
            <p style={{ fontSize: 11.5, color: 'var(--tx-4)', lineHeight: 1.55, margin: '12px 0 0' }}>
              Separately, the platform fee is {(hedgerFeeRate * 100).toFixed(2)}% of the premium, not of what you
              cover. On a $10,000 cover at 1% the premium is $100 and the fee is a share of that $100.
            </p>
          )}
        </div>
      </div>
    </div>,
    host,
  );
}
