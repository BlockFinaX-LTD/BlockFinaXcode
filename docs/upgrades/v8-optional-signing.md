# v8 Optional-Signing Upgrade

**Shipped:** 2026-05-08 — deployed to all three production Diamonds in a single session.
**Branch:** `optional-signing`
**Tests:** 185 / 185 contract tests + 46 / 46 pricing tests passing.

## What changed

The pricing-engine signature is now **advisory** rather than mandatory. Event creators can opt out of the engine and submit their own premium with no on-chain attestation.

Previously, when `pricingEngineSigner` was set on a Diamond:
- Every `createEvent` call **had to** include a valid 65-byte ECDSA signature from the registered signer.
- Empty signatures reverted with `"Quote signature missing or wrong length"`.
- Creators had no escape hatch when the engine was down or returned a bad attestation.

After this upgrade:
- The contract recognises **three** modes inside `_verifyQuoteSignature` instead of two.
- An empty signature is now an explicit, accepted opt-out — recorded on-chain as `quoteSigner = address(0)`.
- Existing engine-attested events keep working exactly as before.

## The three signing modes

| Mode | `pricingEngineSigner` set? | Signature length | Contract accepts? | `HedgeEvent.quoteSigner` stored as |
|---|---|---|---|---|
| **1. Legacy** | No (`address(0)`) | anything | ✓ | `address(0)` |
| **2. Engine-priced** | Yes | exactly 65 bytes (valid ECDSA) | ✓ if `recovered == pricingEngineSigner` | recovered signer (= `pricingEngineSigner`) |
| **3. Self-priced** *(new)* | Yes | **empty** (`0x`) | ✓ | `address(0)` |
| ✗ Malformed | Yes | 1–64 bytes, or > 65 | reverts `"Quote signature wrong length"` | — |

A malformed (non-empty, non-65-byte) signature still reverts. That guard is intentional — anything between 0 and 65 bytes is almost certainly a bug, not an intentional override.

## Why we made it advisory

Three reasons surfaced during testing:

1. **Local-development friction.** When developers ran the stack locally, any drift between the engine's signed payload and the contract's verification payload (e.g. a cached spot price, a tiny float-precision mismatch) would silently produce `"Invalid pricing-engine signature"` — with no way to debug except adding logging server-side. Letting creators opt out gives them a working path while the engine is being calibrated.
2. **Sophisticated creators wanted to override.** Market-makers, partner desks, and anyone running their own pricing model want to set premiums based on their view, not the platform's. Forcing the engine through every event made BlockFinaX unattractive to that segment.
3. **Trust signal still preserved.** Because `quoteSigner` is recorded on-chain per event, hedgers can still see the difference. The buy-dialog UI displays a coloured badge:
   - **✓ Priced by engine** (emerald) — `quoteSigner == pricingEngineSigner`
   - **⚠ Manually priced** (amber) — `quoteSigner == address(0)` with a signer set on-chain

## Deployed addresses

The Diamond proxy address on each chain is **unchanged** — frontends keep pointing at the same address.

| Chain | Diamond (proxy, unchanged) | New HedgeFacet | New OracleFacet | DiamondCut tx |
|---|---|---|---|---|
| **Base** (8453) | `0xbCC51E62C4948FD35ab505bd71804C849601e4Ef` | `0x24eC9B59e820e6e5761363Dd8050f28ea178650C` | `0xBbA9e2709436dDE16b1221602d5850164B0a0392` | [`0x84a4938f…`](https://basescan.org/tx/0x84a4938fb228c7e3801507859b222680d5f75cfcbbeb3977c50537eccc2d26a7) |
| **Lisk** (1135) | `0x69cB5BA093e44B345B617f72a148Ee43c4a18465` | `0xCB38742C24e3315b9590850D76451eB338180EA3` | `0xe0DFb3C060a3f20ef8dbC2b94DfeA65De1fdA875` | [`0x38f4fc53…`](https://blockscout.lisk.com/tx/0x38f4fc53843de80bc9e9496a63b91c8ab9e7ce24a230f5e327d4d2fc99796499) |
| **BSC** (56) | `0xaC939C0897981Abc0711ec4e37527F13106180fc` | `0x42d1Fb5fD4c6459aC00FC3FF3Bc2de9eb7304dC4` | `0xf52Ad63619Bf9cFeF510341ac6b4038554399562` | [`0xc53c8cb2…`](https://bscscan.com/tx/0xc53c8cb2670913cf475f73b0b56dea742b995f785df323d7460c73871ab836f7) |

Deployer: `0xef5Bed7c221c85A2c88e3c0223ee45482d6F037d`. Total gas across all three chains: ~3.3M gas (1.12M per chain). Method: same `scripts/upgrade-hedge-v8.js` flow as the v8 upgrade — replaces all 48 HedgeFacet selectors and all 12 OracleFacet selectors via `diamondCut(replace)`. No storage migration needed; the change is purely additive to the verification logic.

## Frontend changes that ship alongside

### `client/src/pages/hedge.tsx`

- **New checkbox** above the suggested-premium card: *"Use my own pricing (skip engine attestation)"*. When ticked, the createEvent flow skips the engine fetch and submits with `signature = "0x"`. Default off.
- **Buy-dialog badge** — top of the buy dialog, reads the on-chain `quoteSigner` for the event and displays:
  - emerald *"✓ Priced by engine"* when set to the engine's address
  - amber *"⚠ Manually priced"* when set to `address(0)`
- **Diagnostic logs** in `createEvent`: prints the request body sent to `/api/pricing/quote`, the response received, and the final params being submitted on-chain. Helps developers see exactly what's flowing through the pipe when an attestation isn't validating.

### `client/src/lib/hedge-contract.ts`

- All four `parseUnits(...)` price-like inputs (`strike`, `payoutCap`, `premiumRate`, `initialRate`) are now sanitised via `.toFixed(6)` before encoding. JS float math produces noise like `0.0028100000000000004`, which `parseUnits(_, 6)` rejects with *"too many decimals for format"*. This was a real createEvent crash bug in production.
- `HedgeEventData` interface gains an optional `quoteSigner` field, populated by `getEvent()` from the new on-chain getter `getEventQuoteSigner(uint256)`.

### `client/src/pages/hedge.tsx` — `initialRate` mismatch fix

For engine-attested events, the frontend now uses the **server-returned** spot (`fresh.breakdown.spot`) as `initialRate`, not a separately-fetched local spot. Even a 1e-6 difference between the two would cause ECDSA recovery to produce a different address than `pricingEngineSigner` and revert as *"Invalid pricing-engine signature"*. This fix removes one whole class of mismatch bugs.

## What this enables for hedgers

Existing events keep working with no changes — same buy flow, same on-chain settlement.

For new events:
- **Engine-priced** (default) — same fair-value premium the engine has always returned, with on-chain proof the platform vouches for it.
- **Manually priced** — creator sets their own number, hedgers see the badge and decide whether to trust it. Useful for promotional events, market-maker books, or any context where the creator has a better information edge than the engine.

The badge is the trust signal. Hedgers who want algorithmic pricing only buy from "Priced by engine" events; hedgers who want to evaluate the rate themselves are fine with "Manually priced".

## Tests

`contracts/test/unit/quoteSignature.test.js` — 21 tests covering all three modes:
- happy-path engine-priced (mode 2)
- replay protection
- creator/diamond/chainId binding
- expired quote rejection
- timestamp-in-future rejection
- nonce reuse rejection
- **mode 3 — empty signature accepted with `quoteSigner = address(0)`**
- **mode 3 boundary — 64-byte malformed signature still reverts**
- legacy mode disabling re-enables anything-goes

Together with the broader contract suite, **185/185 contract tests pass** on the optional-signing branch.

## Operational notes

- **Cross-env added** to `devDependencies` so `npm run dev` works on Windows out of the box (cmd.exe doesn't understand the Unix `KEY=value command` syntax). No-op on macOS/Linux.
- **Pricing-model PDF** added at [`docs/pricing/pricing-model-explained.pdf`](../pricing/pricing-model-explained.pdf) — 12-section human-readable walkthrough with two worked examples, calibration adjustments, LP economics, and what hedgers receive.

## Rollback plan (if needed)

The change is additive — there's nothing to roll back functionally. If for any reason the new behaviour needs reverting, two options:

1. **Re-deploy the previous facet** via `upgrade-hedge-v8.js` after `git revert`-ing the contract change. Same `diamondCut(Replace)` operation, takes ~1 min per chain.
2. **Disable the engine entirely** by calling `setPricingEngineSigner(address(0))` — flips into legacy mode, which accepts everything. Owner-only, single-tx per chain.

Neither has been needed. Keeping this section as the "what if" record.

## See also

- [`docs/upgrades/v7-range-product-upgrade.md`](v7-range-product-upgrade.md) — the v7 range product + v8 signed-quote upgrade that preceded this
- [`docs/pricing/pricing-engine.md`](../pricing/pricing-engine.md) — the engine that produces the attestations
- [`docs/pricing/pricing-model-explained.html`](../pricing/pricing-model-explained.html) — plain-English pricing-model walkthrough
- [`contracts/src/facets/BlockFinaXHedgeFacet.sol`](../../contracts/src/facets/BlockFinaXHedgeFacet.sol) — `_verifyQuoteSignature` is the function that implements the three modes
