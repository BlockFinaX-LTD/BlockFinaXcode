import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";

export const TERMS_VERSION = "1.1";
export const TERMS_EFFECTIVE_DATE = "4 November 2026";

export default function TermsPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 pb-16">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Terms of Use</h1>
          </div>
        </div>

        <div className="prose prose-sm max-w-none text-foreground space-y-6">
          <div className="bg-muted/50 rounded-xl p-4 border border-border text-sm text-muted-foreground">
            <p><strong>Version {TERMS_VERSION}</strong> · Effective {TERMS_EFFECTIVE_DATE}</p>
            <p className="mt-1">Please read these terms carefully before using BlockFinaX. They apply to your own account and to any business account you create, join or act for.</p>
          </div>

          <Section title="1. About BlockFinaX">
            <p>BlockFinaX is a protocol for currency protection. Businesses buy protection (Caps and Floors) from pools funded by underwriters, and every contract is governed by open-source smart contracts on the Stellar network. Contracts settle at expiry against the reference rate recorded then. All payments, premiums, liquidity and payouts are in USDC.</p>
            <p>USDC held on other networks, such as Base, can be moved to Stellar through Circle's Cross-Chain Transfer Protocol (CCTP). Protection is bought, held and settled on Stellar.</p>
            <p>BlockFinaX Inc. and its contributors (collectively "BlockFinaX", "we", "us") develop and maintain the smart contracts and the interface at this domain. We run the protocol. We are not a counterparty, broker, exchange or financial intermediary in any contract bought or funded through it: protection is sold by pools whose underwriters carry the payouts.</p>
            <p className="mt-2">BlockFinaX Inc. is incorporated in the State of Delaware, United States, with its registered office at 1007 N Orange St, 4th Floor #5543, Wilmington, DE 19801, USA. It is the parent company and the entity with which you are contracting under these Terms. BlockFinaX Ltd, registered in Ghana, is its wholly-owned operating subsidiary. References to "BlockFinaX" in these Terms include both companies.</p>
          </Section>

          <Section title="2. Eligibility">
            <p>By accessing or using BlockFinaX, you represent and warrant that:</p>
            <ul>
              <li>You are at least 18 years of age.</li>
              <li>You have the legal capacity to enter into binding agreements under the laws of your jurisdiction.</li>
              <li>You are not located in, or a national or resident of, any country subject to comprehensive economic sanctions, including but not limited to the United States of America, the OFAC SDN list countries, or any jurisdiction where use of this protocol would be unlawful.</li>
              <li>You are not using the protocol on behalf of any person or entity subject to sanctions.</li>
            </ul>
          </Section>

          <Section title="3. Your Account and Wallet">
            <p>You sign in with your email address or Google account. Your wallet is a smart-contract account on Stellar whose only signer is a passkey created and kept on your own device, unlocked with your fingerprint, face or PIN.</p>
            <ul>
              <li><strong>You control your wallet.</strong> A transaction happens only when you approve it with your passkey. BlockFinaX never receives your passkey's private key and cannot sign for you or move your funds.</li>
              <li><strong>Signing in is not signing.</strong> Your email or Google account identifies you to the app. It cannot approve a transaction.</li>
              <li><strong>Recovery is your responsibility.</strong> If you lose every device that holds your passkeys, nobody, including BlockFinaX, can recover access for you. Keep at least one backup passkey on another device.</li>
              <li><strong>Network fees are covered.</strong> You need only USDC. Transactions you approve are submitted by relayers that pay the network fee. They cannot change what you approved.</li>
            </ul>
          </Section>

          <Section title="4. Business Accounts">
            <p>A business account is a separate smart-contract account on Stellar that belongs to a business, not to the person who created it. Its members each sign in as themselves and approve with their own passkey, within the role an admin gives them:</p>
            <ul>
              <li><strong>Admin:</strong> may do everything, including sending USDC out of the account, inviting and removing members and changing roles.</li>
              <li><strong>Operator:</strong> may buy protection and manage liquidity. May not send USDC out of the account or change its members.</li>
              <li><strong>Viewer:</strong> may see the account but approve nothing.</li>
            </ul>
            <p>These roles are enforced by the business account on Stellar, as well as by the app.</p>
            <p><strong>Authority.</strong> When you create a business account, invite someone to one, or act for one, you represent that you are authorised by that business to do so, and that every person you invite is authorised to act for it in the role you give them.</p>
            <p><strong>The business is bound.</strong> A transaction approved by a member within their role is an act of the business. The business is responsible for the approvals its members give, and for its own compliance with the laws that apply to it.</p>
            <p><strong>Admins manage access.</strong> The business, through its admins, decides who is a member and must remove anyone who should no longer act for it, such as a person who leaves. BlockFinaX cannot add or remove a member's passkey on the business's behalf. A business account always keeps at least one admin, and we recommend at least two.</p>
            <p><strong>Ownership.</strong> USDC, protection contracts and liquidity held by a business account belong to the business, not to the member who deposited, bought or approved them.</p>
            <p><strong>Disputes.</strong> BlockFinaX does not decide disagreements between members, or between a business and its members, about who may act for it or about funds in its account.</p>
            <p>Some features may be available to personal accounts only, as the app shows. We may limit the number of business accounts one person can create.</p>
          </Section>

          <Section title="5. Identity Verification and Transaction Limits">
            <p>Access to certain functions is subject to identity verification. An unverified account may browse the interface but may not buy protection or provide liquidity. Verification is tiered, and the tier you hold determines how much you may transact.</p>
            <ul>
              <li><strong>Basic:</strong> full legal name, phone number, country of residence and a Ghana Card or passport number. Up to $1,000 of value transacted in any rolling 30-day period.</li>
              <li><strong>Verified:</strong> the above plus a photo identity document, proof of address, date of birth and a source of funds declaration. Up to $10,000.</li>
              <li><strong>Enhanced:</strong> the above plus, for businesses, a certificate of incorporation, a directors and shareholders register, a beneficial ownership declaration (10% or more) and a source of wealth declaration. Above $10,000, up to $1,000,000.</li>
            </ul>
            <p>Limits are measured against value actually transferred (premiums paid, payouts received, and liquidity deposited or withdrawn) together with the maximum aggregate payout your open protection contracts could reach. They are cumulative across the period rather than applied to individual transactions.</p>
            <p>For a business account, we may apply limits to the business, to the member who approves a transaction, or to both, and we may require the business and its admins to complete verification.</p>
            <p>We screen the details you provide against international sanctions lists, at verification and periodically thereafter, and we monitor transactions for activity requiring review. We may decline, suspend or limit an account where verification cannot be completed, where a sanctions match is confirmed, or where we are required to do so by law. Where we are legally prohibited from telling you the reason, we will not do so.</p>
            <p>Information collected for this purpose is retained for six years, as required by the Anti-Money Laundering Act, 2020 (Act 1044), and is handled in accordance with our Privacy Policy.</p>
          </Section>

          <Section title="6. How the Protocol Works">
            <ul>
              <li><strong>Pools and underwriters.</strong> Each pool is created and funded by underwriters, who set its markets, terms and limits, including how close to today's rate a strike may be. A pool reserves the full maximum payout of each contract when it is sold.</li>
              <li><strong>Quotes.</strong> A price is signed by BlockFinaX's pricing service and is valid for 120 seconds. If the cost would be higher than the quote when you confirm, the purchase fails and nothing is charged.</li>
              <li><strong>Settlement.</strong> A contract pays only according to the reference rate agreed by the protocol's oracle operators at expiry. There is no physical delivery of any currency.</li>
              <li><strong>Contracts may be upgradeable.</strong> Confirmed transactions are irreversible, but the protocol's contract code and controls may be changed by its on-chain upgrade authority. Check the current contract details in the documentation before transacting.</li>
              <li><strong>Peer to peer.</strong> Businesses and underwriters transact with one another through smart contracts. BlockFinaX does not match orders or act as a market maker.</li>
            </ul>
          </Section>

          <Section title="7. Risk Disclosures">
            <p>Using BlockFinaX involves significant risks. You acknowledge and accept the following:</p>
            <ul>
              <li><strong>Smart contract risk.</strong> Security reviews have defined scope and do not guarantee safety. The historical review described in the Data Room covered a retired deployment and is not evidence that current deployments were audited. Contracts, including third-party account and policy contracts that wallets and business accounts rely on, may contain bugs or vulnerabilities that result in partial or total loss of funds.</li>
              <li><strong>Oracle risk.</strong> Rates used for settlement come from third-party sources. Manipulation, latency or failure could result in incorrect or delayed settlement.</li>
              <li><strong>Currency and market risk.</strong> Exchange rates can move sharply. You may lose the premium you paid, and underwriters may lose capital they deposited.</li>
              <li><strong>Liquidity risk.</strong> A pool may not have enough free capital to sell the protection you want, or to let underwriters withdraw at once.</li>
              <li><strong>Access risk.</strong> Losing your passkeys, or a business losing every admin's passkey, can mean losing access to funds permanently.</li>
              <li><strong>Service dependency.</strong> Network fee sponsorship, transaction relaying, sign-in and rate data depend on third-party services. If they are unavailable, transactions may be delayed.</li>
              <li><strong>Regulatory risk.</strong> The regulatory status of decentralised protocols varies by jurisdiction and may change. You are solely responsible for ensuring your use complies with applicable law.</li>
              <li><strong>Technology risk.</strong> Network congestion, device or browser errors, or software bugs may cause transactions to fail.</li>
            </ul>
          </Section>

          <Section title="8. No Financial Advice">
            <p>Nothing on the BlockFinaX interface or in any associated communication constitutes financial, investment, legal or tax advice. You should conduct your own due diligence and consult qualified advisers before using the protocol.</p>
          </Section>

          <Section title="9. Fees">
            <p>Buying protection costs a premium, paid to the underwriters who back the contract, plus a platform fee. Both are shown, with the total, before you confirm. Underwriting fees and the platform's share of premiums are set on chain and shown in the app and the documentation.</p>
            <p>Network fees are paid by BlockFinaX or its relayer providers, not by you. All fees are non-refundable once a transaction is submitted to the blockchain.</p>
          </Section>

          <Section title="10. Prohibited Uses">
            <p>You agree not to use the protocol to:</p>
            <ul>
              <li>Violate any applicable law or regulation.</li>
              <li>Engage in market manipulation, wash trading, or any form of fraud.</li>
              <li>Launder money or finance any illegal activity.</li>
              <li>Circumvent sanctions or export control regulations.</li>
              <li>Act for a business you are not authorised to act for, or give access to a business account to someone not authorised by that business.</li>
              <li>Conduct any activity that could damage, disable, or impair the protocol or its underlying infrastructure.</li>
            </ul>
          </Section>

          <Section title="11. Suspension and Closure">
            <p>We may suspend or restrict access to the app, for you or for a business account, where we reasonably believe it is needed to comply with law, to protect users or the protocol, or because of a breach of these Terms. Because wallets and business accounts are controlled by their passkeys, suspending access to the app does not take control of your funds. Contracts already bought continue to settle under their terms.</p>
            <p>You may stop using BlockFinaX at any time. Closing your account in the app does not change what is recorded on chain.</p>
          </Section>

          <Section title="12. Intellectual Property">
            <p>The BlockFinaX interface, branding and non-smart-contract software are the intellectual property of BlockFinaX Inc. The smart contracts are open-source and governed by their respective licences. You may not reproduce, redistribute or create derivative works from the interface without prior written consent.</p>
          </Section>

          <Section title="13. Limitation of Liability">
            <p>To the maximum extent permitted by applicable law, BlockFinaX and its contributors shall not be liable for any indirect, incidental, special, consequential or punitive damages, including loss of funds, profits, data or goodwill, arising from your use of the protocol.</p>
            <p>Our total aggregate liability, if any, shall not exceed the protocol fees you paid in the 30 days preceding the event giving rise to the claim.</p>
          </Section>

          <Section title="14. No Warranties">
            <p>The protocol is provided "as is" and "as available" without any warranties, express or implied, including warranties of merchantability, fitness for a particular purpose or non-infringement. We do not warrant that the protocol will be uninterrupted, error-free or free of harmful components.</p>
          </Section>

          <Section title="15. Changes to These Terms">
            <p>We may update these Terms. When we do, we will publish the new version on this page with a new version number and effective date, and tell you about material changes in the app or by email before they take effect. Continued use of BlockFinaX after the effective date constitutes acceptance of the updated Terms.</p>
          </Section>

          <Section title="16. Governing Law">
            <p>These Terms shall be governed by and construed in accordance with applicable law. Any disputes arising under these Terms shall be resolved by binding arbitration, except where prohibited by law.</p>
          </Section>

          <Section title="17. Contact">
            <p>For questions regarding these Terms, please contact us at <a href="mailto:hello@blockfinax.com" className="text-primary underline">hello@blockfinax.com</a>.</p>
          </Section>

          <div className="border-t border-border pt-6 text-xs text-muted-foreground">
            <p>BlockFinaX Terms of Use · Version {TERMS_VERSION} · Effective {TERMS_EFFECTIVE_DATE}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="text-sm text-muted-foreground space-y-2 leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_li]:leading-relaxed">
        {children}
      </div>
    </div>
  );
}
