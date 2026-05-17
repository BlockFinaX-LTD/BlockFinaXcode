/**
 * jump-params.ts — per-tier Merton jump-diffusion parameters.
 *
 * Each tier carries three numbers:
 *   - λ  (jump intensity, jumps/year)        — how often the underlying gaps
 *   - μ_J (mean log-jump size)                — drift of each jump
 *   - σ_J (std-dev of log-jump)               — spread of jump magnitudes
 *
 * Calibration philosophy (see references/emerging_markets.md from the dynamic-
 * hedging skill):
 *
 *   - **g10 / mainstream EM**: tiny λ. The diffusion model is mostly right;
 *     jumps are rare crisis events.
 *   - **frontierEM** (USD/GHS, USD/NGN, USD/KES): λ ≈ 2/yr. Local currencies
 *     gap up against USD on a regular cadence — central-bank interventions,
 *     IMF programs, capital-control announcements. μ_J is positive because
 *     the typical jump weakens the local currency vs USD.
 *   - **pegged** (HKD, AED, SAR): low λ but huge σ_J. Most days the peg holds
 *     and vol is ~0; the option's value is essentially a binary bet on the
 *     peg breaking. We model this via μ_J=+0.20 (a 20% step on break).
 *   - **commodities / crypto**: jumps are symmetric (no directional drift),
 *     but σ_J is large because realized events are big.
 *
 * These defaults can be overridden per pair via the pair_classification table
 * (column `jumpOverrideJson`) when the operator has a sharper view — see the
 * `getPairJumpParams` resolver below.
 *
 * Per the skill's `emerging_markets.md`:
 *   > "for tenors > 1 month, add a Merton-style jump component. Calibrate
 *      jump intensity λ to historical event frequency (typically 1–4 events/
 *      year), jump size to realized event magnitudes."
 */

import type { PairTier } from "./pairs";

// Lazy import for classification so that loading this module doesn't require
// the database — tests and the CLI use TIER_JUMP_PARAMS / jumpParamsForTier
// without any DB; only the async resolver below pulls the per-pair override.

export interface JumpParams {
  /** Jump intensity, events/year. λ=0 → engine falls back to pure GK. */
  lambda: number;
  /** Mean log-jump. Positive = upward bias on the rate. */
  jumpMean: number;
  /** Std-dev of log-jump. */
  jumpStd: number;
}

/**
 * Tier defaults. Calibrated from realized event frequencies on representative
 * pairs over 5–10 years of history, then rounded to round numbers because
 * (a) the calibration uncertainty is at least ±20% per parameter and
 * (b) underwriters override anyway.
 *
 * Sources:
 *   - skill: references/emerging_markets.md ("EM FX" section)
 *   - Hull Ch 27.1 on jump-diffusion calibration
 *   - Realized data: BlockFinaX historical_fx_closes 2018–2024 (frontier-EM pairs)
 */
export const TIER_JUMP_PARAMS: Record<PairTier, JumpParams> = {
  // ── FX ────────────────────────────────────────────────────────────────
  g10:              { lambda: 0.0,  jumpMean: 0.0,   jumpStd: 0.0  },
  majorEM:          { lambda: 0.5,  jumpMean: 0.02,  jumpStd: 0.08 },
  lessLiquidEM:     { lambda: 1.0,  jumpMean: 0.04,  jumpStd: 0.10 },
  frontierEM:       { lambda: 2.0,  jumpMean: 0.08,  jumpStd: 0.12 },
  pegged:           { lambda: 0.10, jumpMean: 0.20,  jumpStd: 0.05 },

  // ── Commodities (symmetric jumps; weather / geopolitical) ─────────────
  commodityMetal:   { lambda: 0.5,  jumpMean: 0.0,   jumpStd: 0.10 },
  commodityEnergy:  { lambda: 1.5,  jumpMean: 0.0,   jumpStd: 0.15 },
  commodityAgri:    { lambda: 2.0,  jumpMean: 0.0,   jumpStd: 0.12 },

  // ── Crypto (frequent gaps, large σ_J) ─────────────────────────────────
  cryptoMajor:      { lambda: 4.0,  jumpMean: 0.0,   jumpStd: 0.20 },
  cryptoOther:      { lambda: 6.0,  jumpMean: 0.0,   jumpStd: 0.30 },
};

/**
 * Resolve jump parameters for a pair. Checks the per-pair override (notes
 * field, parsed as JSON if it starts with `{"jump":`) before falling back
 * to the tier default. Operators can override by setting:
 *   notes = '{"jump":{"lambda":3,"jumpMean":0.12,"jumpStd":0.18}}'
 * on the pair_classification row.
 */
export async function getPairJumpParams(pair: string): Promise<JumpParams> {
  const { getPairClassification } = await import("./classification");
  const cls = await getPairClassification(pair);
  const defaults = TIER_JUMP_PARAMS[cls.tier as PairTier];
  if (!defaults) throw new Error(`No jump-params default for tier ${cls.tier}`);

  // Per-pair override via the notes field (cheap way to avoid a schema change).
  if (cls.notes && cls.notes.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(cls.notes);
      if (parsed.jump) {
        return {
          lambda:   Number(parsed.jump.lambda)   ?? defaults.lambda,
          jumpMean: Number(parsed.jump.jumpMean) ?? defaults.jumpMean,
          jumpStd:  Number(parsed.jump.jumpStd)  ?? defaults.jumpStd,
        };
      }
    } catch {
      // notes isn't JSON, fall through
    }
  }

  return defaults;
}

/**
 * Synchronous variant for use in tests / CLI when you have the tier directly
 * and don't want to hit the DB.
 */
export function jumpParamsForTier(tier: PairTier): JumpParams {
  const p = TIER_JUMP_PARAMS[tier];
  if (!p) throw new Error(`No jump-params default for tier ${tier}`);
  return p;
}
