# BlockFinaX Inc. — Compliance Policy Documents

---

> ## ⚠️ Jurisdiction note — read first
>
> **This document is written against Ghanaian law. The entity that operates the
> platform and holds customer data is BlockFinaX Inc., incorporated in
> Delaware, United States.**
>
> Two companies exist. BlockFinaX Ltd is incorporated in Ghana; BlockFinaX Inc.
> is incorporated in Delaware and is the operating entity. Every framework
> cited below — Act 1044, Act 843, Bank of Ghana directives, the Financial
> Intelligence Centre — binds the Ghanaian company. Which obligations reach the
> Delaware company, and on what basis, has not been determined.
>
> A United States entity offering foreign-exchange risk products raises a
> further set of questions this document does not address at all: money
> services business registration with FinCEN, the status of these products
> under the Commodity Exchange Act, and state money transmitter licensing.
> **None of that is covered here.** It must be resolved with US counsel before
> anything is offered to a US person, and the answers may change the product
> rather than only the paperwork.
>
> *Status as at 8 August 2026. Remove this note once the entity structure and
> the applicable regime are settled.*

---

# PART 1: ANTI-MONEY LAUNDERING AND KNOW YOUR CUSTOMER POLICY

**Version 1.1 | August 2026**

---

## 1. Purpose and Scope

BlockFinaX Inc. is committed to preventing its platform from being used for money laundering, terrorist financing, or any other financial crime. This policy establishes the framework through which BlockFinaX identifies, assesses, and manages the risks associated with financial crime across all platform activities.

This policy applies to all users of the BlockFinaX platform, all employees and contractors of BlockFinaX, and all transactions processed through the platform during the sandbox testing period and beyond.

---

## 2. Regulatory Framework

This policy has been developed in compliance with the following Ghanaian legislation and guidelines:

- Anti-Money Laundering Act, 2020 (Act 1044)
- Anti-Terrorism Act, 2008 (Act 762) and its amendments
- Bank of Ghana AML/CFT Directives
- Financial Intelligence Centre Act, 2004 (Act 651)
- Proceeds of Crime Act, 2010 (Act 804)

---

## 3. Customer Due Diligence (KYC)

### 3.1 Onboarding Requirements

Before any user may transact on the BlockFinaX platform, identity information must be collected and verified. Verification is tiered, and the tier determines how much a customer may transact. An unverified account may browse the platform but cannot buy protection or provide liquidity.

| Tier | Verification | Value transacted (rolling 30 days) | Payout exposure held |
|------|--------------|-----------------------------------|----------------------|
| 0 — Unverified | None | Nil — cannot transact | Nil |
| 1 — Basic | Name, phone, country, Ghana Card or passport number | Up to $1,000 | Up to $1,000 |
| 2 — Verified | Tier 1 plus photo ID, proof of address, date of birth, source of funds | Up to $10,000 | Up to $10,000 |
| 3 — Enhanced | Tier 2 plus incorporation documents, directors and shareholders register, beneficial ownership, source of wealth | Above $10,000 | Above $10,000 |

**Basis of measurement.** Limits are applied to the value actually transferred — premiums paid, payouts received, liquidity deposited and withdrawn — and, separately, to the maximum aggregate payout a customer's open protection contracts could reach.

Notional is deliberately not used. Notional is the size of the exposure a customer is protecting, not a sum that changes hands: a $100,000 position attracts a premium of between $70 and $2,000 depending on the pool, while carrying a maximum payout of $10,000. Measuring against premium alone would permit a $10,000 claim to be acquired for $70; measuring against notional would restrict a customer by reference to an amount that is never transferred. A $100,000 position therefore falls at the Tier 2 threshold, consistent with the enhanced due diligence trigger in section 3.3.

Limits are cumulative across the rolling window rather than applied per transaction, so that a payment cannot be brought within a limit by dividing it.

The following information is collected and verified:

**For Individual Users:**
- Full legal name
- Date of birth
- Ghana Card number or valid government-issued photo identification
- Residential address
- Phone number and email address
- Source of funds declaration for deposits exceeding $1,000 equivalent

**For Business Users:**
- Company name and registration number
- Certificate of Incorporation
- Form 3 and Form 4 (Directors and Shareholders register)
- Beneficial ownership declaration (any individual owning 10% or more)
- Business address and contact details
- Name and identification of at least one authorised signatory

### 3.2 Verification Process

All identity documents are verified through a combination of document review and cross-referencing against available public registries. During the sandbox testing period, manual KYC review will be conducted by BlockFinaX compliance staff before any account is approved for live transactions.

### 3.3 Enhanced Due Diligence

Enhanced due diligence will be applied to the following categories of users:

- Politically Exposed Persons (PEPs) and their close associates
- Users whose transactions exceed $10,000 equivalent in any 30-day period
- Users whose transaction patterns deviate significantly from their stated business purpose
- Users from jurisdictions identified as high risk by the Financial Action Task Force (FATF)

---

## 4. Transaction Monitoring

BlockFinaX maintains automated and manual monitoring of all platform transactions. Tier limits are evaluated before a transaction is permitted; the thresholds below are evaluated after settlement and generate an alert for compliance review rather than blocking the transaction.

The following activity will trigger immediate review:

- Single transactions exceeding $5,000 equivalent
- Cumulative transactions exceeding $10,000 equivalent within any 30-day period
- Multiple transactions structured to remain below reporting thresholds
- Transactions involving wallet addresses flagged on international sanctions lists
- Unusual patterns inconsistent with a user's stated business profile

All flagged transactions will be reviewed by the BlockFinaX compliance officer within 24 hours. Transactions that cannot be satisfactorily explained will be suspended pending investigation.

---

## 5. Sanctions Screening

All users and transaction counterparties are screened against the following lists at onboarding and on an ongoing basis:

| List | Method |
|------|--------|
| United Nations Security Council Consolidated List | Automated, on submission and on re-screening |
| United States Office of Foreign Assets Control (OFAC) SDN List | Automated, on submission and on re-screening, including designated digital currency addresses |
| European Union Consolidated Sanctions List | Manual check by the Compliance Officer at review |
| Ghana Financial Intelligence Centre designated entities list | Manual check by the Compliance Officer at review |

Automated screening covers primary names, recorded aliases and designated wallet addresses. Deposits are additionally screened one transaction hop back: the funding source of a depositing wallet is identified from the transaction's token transfers and screened in its own right.

Wallet screening covers addresses individually designated by OFAC, which at the time of writing includes state-attributed actors and several designated mixers and exchanges. It does not trace exposure through multiple intermediary hops, and it does not cover undesignated mixers or address clusters attributed to an actor without individual designation. That capability requires a blockchain analytics provider and is not in place. Where an automated list cannot be retrieved, the screening is recorded as inconclusive and the account is not approved until the check completes.

A potential match does not itself result in suspension. Name screening produces false positives, and a match is reviewed by the Compliance Officer before any action is taken. Where a match is confirmed, the account is suspended immediately and the relevant authority notified. All screening results are retained, including those returning no match, as evidence of ongoing screening.

---

## 6. Suspicious Transaction Reporting

BlockFinaX will file Suspicious Transaction Reports (STRs) with the Ghana Financial Intelligence Centre (FIC) within 3 working days of identifying a transaction or activity that raises reasonable grounds for suspicion of money laundering or terrorist financing. Reports will be filed in accordance with FIC reporting requirements and will not be disclosed to the subject of the report.

---

## 7. Record Keeping

All KYC documentation, transaction records, and compliance reports will be retained for a minimum of six years from the date of the transaction or the termination of the customer relationship, whichever is later. Records will be stored securely and made available to the Bank of Ghana or any other competent authority upon request.

---

## 8. Compliance Officer

BlockFinaX will designate a Compliance Officer, responsible for the implementation and oversight of this policy, before commencing commercial operations. During the sandbox testing period these responsibilities are discharged by the Chief Executive Officer. The Compliance Officer will conduct regular internal reviews, coordinate with the Bank of Ghana's Fintech and Innovation Office during the sandbox period, and ensure staff receive appropriate AML/CFT training.

---

## 9. Implementation Status

The following controls are implemented in the BlockFinaX platform as at August 2026:

| Control | Status |
|---------|--------|
| Tiered verification with enforced transaction limits | Implemented — checked before every transaction |
| Manual review of all submissions by compliance staff | Implemented |
| Automated screening against OFAC SDN and the UN Consolidated List | Implemented, including aliases and digital currency addresses |
| Screening against the EU and Ghana FIC lists | Manual at review |
| Retention of all screening results, including negative results | Implemented |
| Transaction monitoring against the section 4 thresholds | Implemented — generates compliance alerts |
| Structuring detection | Implemented — repeated transactions below a threshold generate an alert |
| Suspicious Transaction Report workflow | Manual |
| Automated identity document verification | Not implemented — verification is manual during the sandbox period, per section 3.2 |

---

## 10. Policy Review

This policy will be reviewed annually and updated as required to reflect changes in Ghanaian legislation, Bank of Ghana directives, or the operational activities of BlockFinaX.

Where a threshold in this policy is changed, the corresponding value in the platform must be changed in the same revision. The thresholds in sections 3.1, 3.3 and 4 are enforced in code and must not diverge from this document.

---
---

# PART 2: DATA PROTECTION AND PRIVACY POLICY

**Version 1.1 | August 2026**

---

## 1. Purpose

BlockFinaX Inc. is committed to protecting the personal data of all individuals who interact with its platform. This policy sets out how BlockFinaX collects, uses, stores, shares, and protects personal data in compliance with Ghana's Data Protection Act, 2012 (Act 843).

---

## 2. Regulatory Framework

This policy is governed by:

- Data Protection Act, 2012 (Act 843)
- Data Protection Commission of Ghana regulations and guidelines
- Article 18(2) of the Constitution of the Republic of Ghana, 1992 (right to privacy)

BlockFinaX is **not currently registered** with the Data Protection Commission of Ghana. Registration will be completed if the Ghanaian entity begins processing personal data — see the jurisdiction note at the head of this document.

---

## 3. Data We Collect

BlockFinaX collects the following categories of personal data:

**Identity data** — full name, date of birth, government identification number, photograph where provided for KYC purposes.

**Contact data** — email address, phone number, residential or business address.

**Financial data** — transaction history, wallet addresses, USDC balances, protection contract details, and fee records.

**Technical data** — IP address, browser type, device identifiers, and platform usage logs.

**Business data** — company registration details, beneficial ownership information, and business purpose declarations submitted during onboarding.

---

## 4. How We Use Personal Data

Personal data is collected and processed solely for the following purposes:

- Verifying user identity in compliance with our AML/KYC obligations
- Operating and administering user accounts and transactions on the platform
- Detecting and preventing fraud, money laundering, and financial crime
- Communicating with users regarding their accounts, transactions, and platform updates
- Complying with regulatory reporting requirements, including obligations to the Bank of Ghana and the Financial Intelligence Centre
- Improving platform functionality and user experience through anonymised usage analytics

Personal data will not be used for purposes beyond those listed above without the explicit consent of the data subject.

---

## 5. Legal Basis for Processing

BlockFinaX processes personal data on the following legal bases under the Data Protection Act, 2012:

- **Consent** — where users have expressly agreed to data collection at onboarding
- **Contractual necessity** — where processing is required to deliver the services the user has requested
- **Legal obligation** — where processing is necessary to comply with AML, KYC, and regulatory reporting requirements

---

## 6. Data Sharing

BlockFinaX does not sell personal data to third parties. Personal data may be shared in the following limited circumstances:

- With the Bank of Ghana, Financial Intelligence Centre, or other competent authorities where required by law or regulatory obligation
- With identity verification service providers engaged to support KYC processes, bound by equivalent data protection obligations
- With blockchain infrastructure providers, noting that wallet addresses and on-chain transaction data are inherently public on the Lisk blockchain network

Users will be informed of any data sharing arrangements at the point of onboarding.

---

## 7. Data Security

BlockFinaX employs the following measures to protect personal data:

- AES-256 encryption for all stored private keys and sensitive user data
- Encrypted transmission of data between user devices and the platform server
- Session-based authentication with automatic timeout for inactive sessions
- Access controls limiting personal data access to authorised personnel only
- Regular security reviews during the sandbox testing period

---

## 8. Data Retention

Personal data will be retained for the following periods:

- KYC and identity documents: six years from the end of the customer relationship
- Transaction records: six years from the date of the transaction
- Platform usage logs: twelve months from the date of collection

Data will be securely deleted at the end of the applicable retention period.

---

## 9. User Rights

In accordance with the Data Protection Act, 2012, users have the following rights:

- The right to access personal data held about them
- The right to correct inaccurate or incomplete personal data
- The right to request deletion of personal data, subject to legal retention obligations
- The right to object to processing of personal data for purposes beyond contractual or legal necessity

Requests may be submitted to the BlockFinaX Data Protection Officer. BlockFinaX will respond within 21 days of receiving a valid request.

---

## 10. Data Protection Officer

BlockFinaX **has not yet designated** a Data Protection Officer. One will be appointed before commercial operations begin. Until then these responsibilities are discharged by the Chief Executive Officer, who is the point of contact for data subjects. Requests should be sent to hello@blockfinax.com.

---

## 11. Policy Review

This policy will be reviewed annually and updated as required to reflect changes in Ghanaian data protection law or the operational activities of BlockFinaX.
