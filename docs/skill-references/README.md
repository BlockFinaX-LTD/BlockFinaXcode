# Skill reference PDFs

Two canonical sources behind the BlockFinaX pricing engine. The
[dynamic-hedging Claude skill](https://github.com/BlockFinaX-LTD/finance-claude-skill)
pulls from these when explaining the math or extending the model.

| File | What it is |
|---|---|
| `derivatives.pdf` | John Hull, *Options, Futures, and Other Derivatives* (10th ed) — textbook reference. Chapters most relevant to the engine: Ch 17 (currency options, Garman–Kohlhagen), Ch 20 (volatility smiles), Ch 23 (EWMA + GARCH), Ch 27 (jump-diffusion, stochastic vol). |
| `hedge.pdf` | Nassim Taleb, *Dynamic Hedging* — trader/practitioner reference. Ch 6 (vol & correlation), Ch 9 (vega + vol surface), Ch 15 (fat tails & vol-of-vol), Ch 17–23 (exotics). |

These are kept for reference only — they're the citations behind the v2
engine's design (Merton jump-diffusion + GARCH(1,1) integrated variance).

## Quick reference: engine ↔ source mapping

| Engine component | Hull section | Taleb chapter |
|---|---|---|
| `garmanKohlhagenCall/Put` in [kernel.ts](../../server/pricing/kernel.ts) | §17.5 | Ch 11 |
| `mertonCall/Put` in [kernel.ts](../../server/pricing/kernel.ts) | §27.1 | Ch 15 (fat tails) |
| `integratedVariance` in [garch.ts](../../server/pricing/data/garch.ts) | §23.3 | Ch 6 |
| Threshold jump detection in [calibrate-jumps.ts](../../server/pricing/scripts/calibrate-jumps.ts) | §27.1 | Ch 15 |
| Variance-targeted MLE in [calibrate-garch.ts](../../server/pricing/scripts/calibrate-garch.ts) | §23.5 | — |
| Walk-forward [backtest.ts](../../server/pricing/scripts/backtest.ts) | §23 (forecasting) | Ch 3 (P/L attribution) |
