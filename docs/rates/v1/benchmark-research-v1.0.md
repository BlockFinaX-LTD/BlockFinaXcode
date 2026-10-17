# Interest-Rate Benchmark Research v1.0

| Field | Value |
| --- | --- |
| Title | Interest-rate benchmark research |
| Version | 1.0 |
| Status | Draft |
| Date | 2026-10-17 |
| Owner | BlockFinaX |
| Related documents | [Oracle architecture](oracle-architecture-v1.0.md), [Benchmark registry](benchmark-registry-v1.0.md), [Settlement rules](settlement-rules-v1.0.md), [Licensing](licensing-v1.0.md), [Pricing integration](pricing-integration-v1.0.md), ADR-RATE-001 to ADR-RATE-005 |
| Supersedes | None |

This is research for planning. Nothing here is implemented. Where a fact could not be confirmed from a primary source it is marked **Unconfirmed** and must be checked before any production use.

## 1. Summary

| Benchmark | Currency | Administrator | Type | Frequency | Machine-readable official source | Commercial use | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOFR | USD | Federal Reserve Bank of New York | Daily overnight (secured) | Each US business day, about 08:00 ET, for the previous business day | Yes: JSON API (verified 2026-10-17) | Permitted under NY Fed Terms of Use with notice and disclaimer | **Launch first (testnet)** |
| SONIA | GBP | Bank of England | Daily overnight (unsecured) | 09:00 London, next London business day | Yes: IADB CSV (verified responds) | Free via IADB under Open Government Licence; **redistribution to clients needs a direct licence** | Build next, after licence answer |
| EURIBOR 1M/3M/6M | EUR | EMMI | Term (each tenor a separate benchmark) | Each TARGET2 day, 11:00 CET | Paid subscription; free data is 24h delayed and non-commercial | Subscription mandatory; derived-data licence (EMMI 2026-27 schedule: EUR 38,000 a year) | **Do not support yet** |
| KESONIA | KES | Central Bank of Kenya | Daily overnight (unsecured interbank) | By 09:00 each Kenyan business day, for the previous business day | HTML table on CBK site; no API found | **Unconfirmed** (no terms on the page) | **Launch first (testnet)**; confirm terms with CBK |
| NOFR | NGN | Central Bank of Nigeria (with FMDA) | Daily overnight (secured repo, at least NGN 5bn trades) | 10:00 Lagos, business day after fixing | **Unconfirmed** (no archive found) | **Unconfirmed** | Research further |
| Ghana Reference Rate (GRR) | GHS | Ghana Association of Banks (industry formula) | Monthly reference rate | About once a month; effective dates vary (7 Jan, 6 May, 3 Jun, 1 Jul 2026) | Notices on gab.com.gh and press; no data feed found | **Unconfirmed** | Build next (high relevance, governance to confirm) |
| Ghana 91-day T-bill | GHS | Bank of Ghana (auction agent for Government) | Weekly auction rate | Weekly auction results (Friday auctions reported) | Auction results on BoG site; format **Unconfirmed** | Government data, terms **Unconfirmed** | Build next |
| ZARONIA | ZAR | South African Reserve Bank | Daily overnight (unsecured) | 10:00 each SA business day; republication allowed before 12:00 | SARB web pages; download format **Unconfirmed** | **Unconfirmed** | Build next (JIBAR ends 31 Dec 2026) |
| Policy rates (CBR, MPR Ghana, MPR Nigeria, SARB repo) | KES, GHS, NGN, ZAR | Central banks | Policy rate | Changes only at policy decisions | Central bank statements | Public announcements | Separate product family, see settlement rules |

## 2. Per-benchmark findings

### SOFR (USD)
- **Represents:** cost of overnight borrowing collateralised by US Treasuries (repo).
- **Used in lending:** yes. It is the main USD floating-rate benchmark after LIBOR, including trade finance and corporate loans.
- **Publication:** about 08:00 ET each US business day for the previous business day.
- **Observation date:** `effectiveDate` in the API is the business day the rate represents. This is not the publication day.
- **Revisions:** same-day only, up to about 14:30 ET. The API carries a `revisionIndicator`. Earlier values are not changed after the fact.
- **Precision:** two decimal places in percent (for example 3.89).
- **History:** official since April 2018.
- **API:** `https://markets.newyorkfed.org/api/rates/secured/sofr/last/N.json`. Verified on 2026-10-17: it returned 3.89% for 2026-10-15, with percentiles and volume.
- **Terms:** use, copy and distribute for business purposes, with a notice, a disclaimer and a "not affiliated with the New York Fed" statement. SOFR uses data licensed from DTCC Solutions.
- **Fallback source:** the same data on the NY Fed website; CME and others for validation only.
- **Negative rates:** possible in principle, so validation must allow them.

### SONIA (GBP)
- **Represents:** unsecured overnight sterling borrowing.
- **Used in lending:** yes, it is the main GBP floating-rate benchmark.
- **Publication:** 09:00 London on the following London business day, for the day the transactions were executed.
- **Revisions:** republished if the change is 2 basis points or more, no later than midday, once. No changes after that.
- **Contingency:** a defined fallback rate (Bank Rate plus a recent mean spread) when data is insufficient.
- **Precision:** 4 decimal places.
- **History:** back to 1997; reformed methodology from 23 April 2018.
- **Source:** Bank of England IADB (series IUDSOIA), free from 10:00 next working day under the Open Government Licence.
- **Licensing:** a direct licence is required to redistribute SONIA data to clients. See [licensing](licensing-v1.0.md).

### EURIBOR 1M / 3M / 6M (EUR)
- **Represents:** bank funding at term; each tenor is a separate benchmark.
- **Used in lending:** yes, widely in EUR loans.
- **Licensing:** a subscription is mandatory for any commercial use. Free delayed data is non-commercial only. Derived products need a separate licence.
- **Recommendation:** do not support until a licence is signed.

### KESONIA (KES)
- **Represents:** volume-weighted average of unsecured overnight interbank lending in Kenyan shillings. It is a renaming of the existing overnight interbank average, with no methodology change.
- **Used in lending:** yes, and this is the strongest finding. CBK's revised risk-based credit pricing model prices **variable-rate KES loans as KESONIA (compounded in arrears) plus a bank premium**:
  - new variable-rate loans from 1 Sep 2025
  - existing loans migrating by 28 Feb 2026
  - CBK's Central Bank Rate (CBR) is the allowed fallback reference
- **Publication:** by 09:00 each business day, for the previous business day. On weekends and holidays, the last working day's rate is held.
- **History:** as KESONIA, from 1 Sep 2025. The underlying interbank average has a longer history; daily interbank PDF reports date from at least July 2014.
- **Source:** CBK website table, plus a KESONIA Compounded Index. No API found.
- **Revisions and terms:** **Unconfirmed**.

### NOFR (NGN)
- **Represents:** secured overnight repo funding, from trades of at least NGN 5bn. Calculated as a volume-weighted trimmed mean, dropping the top and bottom 10%.
- **Launched:** 17 April 2026. CBN is the administrator, with FMDA.
- **Publication:** 10:00 Lagos on the business day after the fixing day.
- **Data gaps:** if there aren't enough trades, the previous day's rate is reused and disclosed.
- **Corrections:** only for material errors of 5bp or more.
- **Used in lending:** early. It is a money-market benchmark; evidence of corporate loans referencing NOFR was not found.
- **History:** six months.
- **Data source and licensing:** official archive and terms **Unconfirmed**.
- **Volatility:** Nigerian overnight rates can swing by many percentage points during liquidity squeezes.

### Ghana Reference Rate (GRR)
- **Represents:** an industry formula combining the Monetary Policy Rate, Treasury bill yields and the interbank rate. The weights are **Unconfirmed**.
- **Publisher:** the Ghana Association of Banks, an industry body, not the central bank.
- **Used in lending:** yes. Banks use it as the base for loan pricing, and floating-rate loans reset after each monthly publication.
- **Frequency:** monthly. The January 2026 notice says each rate remains in place for at least 30 working days.
- **Effective dates:** irregular (for example 7 Jan, 6 May, 3 Jun, 1 Jul 2026).
- **2026 values:**

  | Month | Rate |
  | --- | --- |
  | January | 15.68% |
  | February | 14.58% |
  | March | 11.71% |
  | April | 10.06% |
  | May | 10.03% |
  | June | 10.02% |
  | July | 10.59% |
  | August | 10.61% |

- **Machine-readable source:** none found. Governance and terms are **Unconfirmed**.

### Ghana 91-day Treasury bill
- **Represents:** the government borrowing cost at weekly auction, published by the Bank of Ghana. It is also an input to the GRR.
- **Volatility:** it moves a lot. Reported 91-day weighted averages: about 25.2% (Feb 2025), 11.1% (Jan 2026), 5.87% (Jul 2026).
- **Settlement:** a product would settle on a named auction's result, not on any daily quote.
- **Still to confirm:** result format and the discount-to-yield convention are **Unconfirmed**.

### ZARONIA (ZAR)
- **Represents:** unsecured overnight rand funding.
- **Publication:** 10:00 each SA business day. Republication is allowed before 12:00 to fix errors.
- **Official since:** observation period ended 3 Nov 2023. Rates before 31 Oct 2022 are pre-publication proxies and must be labelled as such.
- **Used in lending:** rising fast. JIBAR permanently ceases after its final publication on 31 December 2026, so rand floating-rate loans are moving to ZARONIA in 2026.
- **Term ZARONIA:** a forward-looking version is in development.
- **Data format and terms:** **Unconfirmed**.

### Better local benchmarks considered
- **Kenya:** KESONIA is the right one, because regulation now prices variable loans off it. CBR is its official fallback.
- **Ghana:** the GRR is what banks actually price loans off, which makes it more relevant to borrowers than the 91-day bill. But it is an association formula with irregular effective dates. The 91-day bill is cleaner, official, and a GRR input.
- **Nigeria:** the MPR drives bank loan repricing in practice, and NIBOR is legacy. NOFR is the official new benchmark but very young. For borrowers today, **MPR-based policy-rate protection** is likely more relevant than NOFR.
- **South Africa:** ZARONIA, given JIBAR's end in 2026. Prime (repo plus a fixed spread) is what many SME loans reference, which makes a **SARB repo / prime** policy-rate product relevant.

## 3. Scores (1 = poor, 5 = strong)

| Benchmark | Business relevance | Official-source quality | API access | Publication reliability | Historical depth | Licensing simplicity | Oracle simplicity | Pricing usefulness | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOFR | 4 | 5 | 5 | 5 | 4 | 4 | 5 | 5 | **37** |
| SONIA | 3 | 5 | 4 | 5 | 5 | 2 | 4 | 5 | 33 |
| KESONIA | 5 | 4 | 2 | 4 | 2 | 3 | 3 | 3 | **26** |
| ZARONIA | 4 | 4 | 2 | 4 | 2 | 3 | 3 | 3 | 25 |
| Ghana 91-day T-bill | 3 | 4 | 2 | 4 | 4 | 3 | 3 | 4 | 27 |
| GRR | 5 | 2 | 1 | 3 | 2 | 2 | 2 | 2 | 19 |
| NOFR | 2 | 4 | 1 | 3 | 1 | 2 | 2 | 1 | 16 |
| EURIBOR | 4 | 5 | 2 | 5 | 5 | 1 | 3 | 5 | 30 (licence blocks) |
| Policy rates | 5 | 5 | 2 | 3 (meetings move) | 5 | 4 | 3 | 3 | 30 |

Scores for KESONIA, ZARONIA, GRR, the T-bill and NOFR assume the **Unconfirmed** items resolve neutrally.

## 4. Recommendation

| Tier | Benchmarks | Why |
| --- | --- | --- |
| **Launch first (testnet)** | SOFR; KESONIA | SOFR is the cleanest source end to end. KESONIA is the most relevant African benchmark, because Kenyan variable loans are priced off it. Production for KESONIA needs CBK confirmation on terms and corrections. |
| **Build next** | Policy-rate protection (CBR, Ghana MPR, Nigeria MPR, SARB repo); ZARONIA; Ghana 91-day T-bill; SONIA (after licence) | Policy rates match how SMEs are actually repriced in Ghana, Nigeria and South Africa. ZARONIA becomes the rand loan benchmark in 2026. |
| **Research further** | GRR; NOFR | GRR: governance, formula and effective-date rule. NOFR: history, archive and adoption. |
| **Do not support yet** | EURIBOR | Commercial licence required. |

The shortlist hypothesis (SOFR, SONIA, KESONIA, NOFR) changes:
- **NOFR moves down:** too new, no history, little loan adoption.
- **SONIA waits for its licence answer.**
- **Policy-rate protection is added:** for Ghana and Nigeria it matches actual borrower exposure better than any daily benchmark available today.

## 5. Product and tenor compatibility

| Benchmark type | Example | Minimum tenor | Settlement observation | Notes |
| --- | --- | --- | --- | --- |
| Daily overnight | SOFR, KESONIA, ZARONIA, SONIA | 30 days | Compounded in arrears over the protection period (default), or one named fixing | Matches how loans accrue; one day's fixing is noisy and easier to manipulate |
| Term | EURIBOR 3M | Equal to the term | The fixing on a named date | Not supported yet |
| Monthly reference | GRR | 2 publication periods (about 60 days) | The GRR in force on the expiry date | Never offer 3 or 7-day products |
| Auction | Ghana 91-day T-bill | 2 auctions (about 14 days); practical 30+ | The result of the auction held on or immediately before expiry | Auctions can be cancelled; see settlement rules |
| Policy rate | CBR, MPR, repo | Must span at least one scheduled decision | The rate in force on the expiry date | Postponements handled by design, see settlement rules |

## 6. Historical data

| Benchmark | Earliest official | Earlier proxy | Notes |
| --- | --- | --- | --- |
| SOFR | 3 Apr 2018 | Indicative from 2014 (label as proxy) | Methodology modified 25 Nov 2024, not back-revised |
| SONIA | 1997 | none | Methodology reform 23 Apr 2018 |
| KESONIA | 1 Sep 2025 | Interbank average under its old name (same methodology) | Confirm the archive format |
| NOFR | 17 Apr 2026 | none | Too short for calibration |
| GRR | 2018 launch | none | Formula changes **Unconfirmed** |
| Ghana 91-day | Long auction history | none | Regime shifts (2022 to 2025 crisis) |
| ZARONIA | 2 Nov 2022 | Pre-publication proxies before 31 Oct 2022 (label as proxy) | Short |

## Sources

- [New York Fed Terms of Use](https://www.newyorkfed.org/privacy/termsofuse); NY Fed SOFR API (queried 2026-10-17); [ARRC templates for using SOFR](https://www.newyorkfed.org/medialibrary/microsites/arrc/files/2019/Templates_for_Using_SOFR.pdf); [NY Fed operating policy, 25 Nov 2024](https://www.newyorkfed.org/markets/opolicy/operating_policy_241125)
- [Bank of England: SONIA key features and policies](https://www.bankofengland.co.uk/markets/sonia-benchmark/sonia-key-features-and-policies); [Bank of England legal](https://www.bankofengland.co.uk/legal)
- [EMMI subscriptions FAQ](https://www.emmi-benchmarks.eu/faq/subscriptions/); [EMMI 2026-2027 fee schedule](https://www.emmi-benchmarks.eu/globalassets/documents/pdf/subscriptions/d0167a-2026---2027-fee-schedule.pdf); [EMMI limited data sharing addendum](https://www.emmi-benchmarks.eu/globalassets/documents/pdf/subscriptions/rates-plans/agreements/2026/addendum_addendum-for-limited-data-sharing.pdf)
- [CBK: KESONIA](https://www.centralbank.go.ke/kesonia/); [CBK revised risk-based credit pricing model](https://www.centralbank.go.ke/wp-content/uploads/2025/08/Revised-Risk-based-Credit-Pricing-Model.pdf); [TechCabal on KESONIA](https://techcabal.com/2025/08/27/kenya-overhauls-loan-pricing-model-interbank-benchmark/)
- [Mondaq: introduction of NOFR](https://www.mondaq.com/nigeria/finance-and-banking/1803732/regulatory-update-introduction-of-nigerian-overnight-financing-rate-implications-for-pricing-risk-and-documentation-in-nigerias-money-market-transactions); [Guardian NG: CBN unveils NOFR](https://guardian.ng/business-services/cbn-unveils-fresh-benchmark-to-strengthen-investor-confidence/); [Financial EDGE on NOFR](https://www.financialedge.com.ng/central-bank-of-nigeria-and-financial-market-dealers-association-announce-the-nigerian-overnight-financing-rate-nofr-as-new-money-market-benchmark)
- [Ghana Association of Banks](https://www.gab.com.gh); [Citi Newsroom: GRR August 2026](https://www.citinewsroom.com/2026/08/ghana-reference-rate-increases-to-10-61-in-august-as-lending-conditions-remain-stable/); [Citi Newsroom: GRR July 2026](https://www.citinewsroom.com/2026/07/ghana-reference-rate-climbs-to-10-59-in-july-reversing-months-of-decline/); [Citi Business News: 2018 reference rate](https://citibusinessnews.com/2018/04/bog-puts-reference-rate-for-april-at-16-82/)
- [GNA: T-bill rates July 2026](https://gna.org.gh/2026/07/treasury-bill-rates-edge-up-in-latest-bog-auction/); [GNA: T-bill auction January 2026](https://gna.org.gh/2026/01/government-raises-gh%c2%a212-78bn-at-t-bill-auction/); [Graphic: T-bill auction results](https://www.graphic.com.gh/business/business-news/bank-of-ghana-treasury-bills-auction-results-demand-surpasses-accepted-bids-amid-rising-interest-rates.html)
- [SARB: ZARONIA](https://www.resbank.co.za/en/home/what-we-do/financial-markets/south-african-overnight-index-average); [SARB: compounded ZARONIA](https://www.resbank.co.za/en/home/what-we-do/financial-markets/compounded-zaronia-period-averages-and-index); [SARB media release on JIBAR](https://www.resbank.co.za/en/home/publications/publication-detail-pages/media-releases/2026/jibar-tax); [JSE hotline on ZARONIA republication](https://clientportal.jse.co.za/Content/JSEHotlinesItems/JSE%20Service%20Hotline%2004025%20Market%20Data%20-%20Project%20ZARONIA%20-%20Impact%20to%20Bonds%20Coupon%20Rate%20Update%20due%20to%20ZARONIA%20Rate%20Republication.pdf)
- [ThisDay: CBN postpones MPC (2018)](https://thisdaylive.com/index.php/2018/11/17/cbn-postpones-mpc-meeting); [ICIR: CBN postpones MPC](https://www.icirnigeria.org/critical-economic-decisions-put-on-hold-as-cbn-postpones-mpc-meeting/); [The Cable: CBN postpones MPC](https://thecable.ng/new-date-will-be-communicated-cbn-postpones-mpc-meeting)
