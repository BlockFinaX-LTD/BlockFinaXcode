# BlockFinaX Documentation

Five buckets, one purpose each. Pick the bucket that matches what you're trying
to do; READMEs inside each subfolder list its contents (or just `ls` the folder).

```
docs/
├── architecture/   ← How the protocol is designed
├── explainers/     ← How the code works (line-by-line walkthroughs)
├── pricing/        ← Pricing engine: math, data sources, signed-quote attestation
├── upgrades/       ← Upgrade history + future roadmap
└── ops/            ← Day-to-day operations (dev guide, compliance, marketing)
```

## architecture/ — Protocol design

| File | What's in it |
|---|---|
| [system-map.md](architecture/system-map.md) | One-page overview of every moving piece |
| [protocol-v2-advance-specification.md](architecture/protocol-v2-advance-specification.md) | Full spec of the v2 protocol design |
| [range-strike-lp-token-design.md](architecture/range-strike-lp-token-design.md) | Design rationale for range payouts and LP shares |
| [oracle-strategy.md](architecture/oracle-strategy.md) | Multi-signer oracle consensus design |

## explainers/ — How the code works

| File | What's in it |
|---|---|
| [contracts-explained.md](explainers/contracts-explained.md) | Comprehensive walkthrough of every contract |
| [contracts-explained-simple.md](explainers/contracts-explained-simple.md) | Same content, plain-English version |
| [hedge-system-developer-notes.md](explainers/hedge-system-developer-notes.md) | Internal notes from the dev process |
| [smart-contract-functions.md](explainers/smart-contract-functions.md) | Function-by-function reference |

## pricing/ — Pricing engine

| File | What's in it |
|---|---|
| [pricing-engine.md](pricing/pricing-engine.md) | Complete pricing engine doc: data sources, formulas, EM drift correction, signed quotes |
| [pricing-model-explained.html](pricing/pricing-model-explained.html) / [.pdf](pricing/pricing-model-explained.pdf) | Plain-English walkthrough of the model — 12 sections including two worked examples (USD/NGN 90d and USD/GHS 30d), six calibration adjustments, LP economics, and what hedgers actually receive |

## upgrades/ — Upgrade history & roadmap

| File | What's in it |
|---|---|
| [v7-range-product-upgrade.md](upgrades/v7-range-product-upgrade.md) | The range-product upgrade (v7) and signed-quote attestation (v8) |
| [v8-optional-signing.md](upgrades/v8-optional-signing.md) | Optional-signing upgrade (2026-05-08) — engine attestation made advisory rather than mandatory; deployed addresses + UI changes + new self-priced badge flow |
| [infrastructure-roadmap.md](upgrades/infrastructure-roadmap.md) | Forward-looking roadmap: what to build next and why |

## ops/ — Operations

| File | What's in it |
|---|---|
| [developer-guide.md](ops/developer-guide.md) | New-developer onboarding, repo layout, commands |
| [compliance-aml-kyc-policy.md](ops/compliance-aml-kyc-policy.md) | AML/KYC policy |
| [marketing-youtube-scripts.md](ops/marketing-youtube-scripts.md) | Marketing content drafts |
