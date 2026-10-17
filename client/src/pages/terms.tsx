import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";

export const TERMS_VERSION = "1.0";
export const TERMS_EFFECTIVE_DATE = "1 July 2026";

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
            <p className="mt-1">Please read these terms carefully before using the BlockFinaX protocol.</p>
          </div>

          <Section title="1. About the Protocol">
            <p>BlockFinaX is a decentralised peer-to-peer (P2P) hedging protocol built on Base and BNB Smart Chain. The protocol enables users to create, buy, and provide liquidity for FX and commodity protection contracts governed entirely by open-source smart contracts. Contracts settle at expiry on the rate recorded then.</p>
            <p>BlockFinaX Inc. and its contributors (collectively "BlockFinaX", "we", "us") develop and maintain the smart contract infrastructure and the interface at this domain. We do not operate as a counterparty, broker, exchange, or financial intermediary in any transaction executed through the protocol.</p>
            <p className="mt-2">BlockFinaX Inc. is incorporated in the State of Delaware, United States, with its registered office at 1007 N Orange St, 4th Floor #5543, Wilmington, DE 19801, USA. It is the parent company and the entity with which you are contracting under these Terms. BlockFinaX Ltd, registered in Ghana, is its wholly-owned operating subsidiary. References to "BlockFinaX" in these Terms include both companies.</p>
          </Section>

          <Section title="2. Eligibility">
            <p>By accessing or using the BlockFinaX protocol, you represent and warrant that:</p>
            <ul>
              <li>You are at least 18 years of age.</li>
              <li>You have the legal capacity to enter into binding agreements under the laws of your jurisdiction.</li>
              <li>You are not located in, or a national or resident of, any country subject to comprehensive economic sanctions, including but not limited to the United States of America, the OFAC SDN list countries, or any jurisdiction where use of this protocol would be unlawful.</li>
              <li>You are not using the protocol on behalf of any person or entity subject to sanctions.</li>
            </ul>
          </Section>

          <Section title="3. Identity Verification and Transaction Limits">
            <p>Access to certain functions is subject to identity verification. An unverified account may browse the interface but may not buy protection or provide liquidity. Verification is tiered, and the tier you hold determines how much you may transact.</p>
            <ul>
              <li><strong>Basic</strong> — name, phone number, country of residence and a government identity number. Up to $1,000 of value transacted in any rolling 30-day period.</li>
              <li><strong>Verified</strong> — the above plus a photo identity document, proof of address, date of birth and a source of funds declaration. Up to $10,000.</li>
              <li><strong>Enhanced</strong> — the above plus, for businesses, incorporation documents, a directors and shareholders register, a beneficial ownership declaration and a source of wealth declaration. Above $10,000.</li>
            </ul>
            <p>Limits are measured against value actually transferred — premiums paid, payouts received, and liquidity deposited or withdrawn — together with the maximum aggregate payout your open protection contracts could reach. They are cumulative across the period rather than applied to individual transactions.</p>
            <p>We screen the details you provide against international sanctions lists, at verification and periodically thereafter, and we monitor transactions for activity requiring review. We may decline, suspend or limit an account where verification cannot be completed, where a sanctions match is confirmed, or where we are required to do so by law. Where we are legally prohibited from telling you the reason, we will not do so.</p>
            <p>Information collected for this purpose is retained for six years, as required by the Anti-Money Laundering Act, 2020 (Act 1044), and is handled in accordance with our Privacy Policy.</p>
          </Section>

          <Section title="4. Nature of the Protocol">
            <p>BlockFinaX is an application that interacts with upgradeable on-chain contracts and off-chain services. Custody, settlement paths and transaction requirements depend on the specific wallet, chain and contract used:</p>
            <ul>
              <li><strong>Understand custody for each transaction.</strong> Where a transaction uses an on-chain contract, control and settlement depend on the connected wallet and the specific deployed contract. Upgradeability, contract code, oracle, liquidity and network risks may apply. Check the current contract address and status before transacting.</li>
              <li><strong>Contracts may be upgradeable.</strong> Confirmed transactions are generally irreversible, but protocol code and controls may be changed by the on-chain upgrade authority.</li>
              <li><strong>Settlement depends on oracle inputs and an on-chain transaction.</strong> No physical delivery of an underlying asset occurs. The settlement token depends on the chain and event configuration.</li>
              <li><strong>The protocol is peer-to-peer.</strong> Hedgers and liquidity providers transact directly with one another through smart contracts. BlockFinaX does not match orders or act as a market maker.</li>
            </ul>
          </Section>

          <Section title="5. Risk Disclosures">
            <p>Use of the protocol involves significant risks. You acknowledge and accept the following:</p>
            <ul>
              <li><strong>Smart contract risk.</strong> Security reviews have defined scope and do not guarantee safety. The historical review described in the Data Room covered a retired deployment and is not evidence that current deployments were audited. Contracts may contain bugs or vulnerabilities that result in partial or total loss of funds.</li>
              <li><strong>Oracle risk.</strong> Price feeds used for settlement are sourced from third-party providers. Oracle manipulation, latency, or failure could result in incorrect or missed settlements.</li>
              <li><strong>FX and market risk.</strong> The value of reference assets can move dramatically, resulting in the loss of premiums paid or capital deposited.</li>
              <li><strong>Liquidity risk.</strong> Liquidity pools may be insufficient to cover payouts in extreme market conditions.</li>
              <li><strong>Regulatory risk.</strong> The regulatory status of decentralised protocols varies by jurisdiction and may change. You are solely responsible for ensuring your use complies with applicable law.</li>
              <li><strong>Technology risk.</strong> Network congestion, wallet errors, or software bugs may cause transactions to fail or settle at unintended prices.</li>
            </ul>
          </Section>

          <Section title="6. No Financial Advice">
            <p>Nothing on the BlockFinaX interface or in any associated communication constitutes financial, investment, legal, or tax advice. You should conduct your own due diligence and consult qualified advisors before using the protocol.</p>
          </Section>

          <Section title="7. Fees">
            <p>Fees are configured on chain and may vary by network, event and transaction type. The app should show the applicable amount before a transaction is submitted; verify the quoted fee and token in your wallet before signing.</p>
            <p>All fees are non-refundable once a transaction is submitted to the blockchain.</p>
          </Section>

          <Section title="8. Prohibited Uses">
            <p>You agree not to use the protocol to:</p>
            <ul>
              <li>Violate any applicable law or regulation.</li>
              <li>Engage in market manipulation, wash trading, or any form of fraud.</li>
              <li>Launder money or finance any illegal activity.</li>
              <li>Circumvent sanctions or export control regulations.</li>
              <li>Conduct any activity that could damage, disable, or impair the protocol or its underlying infrastructure.</li>
            </ul>
          </Section>

          <Section title="9. Intellectual Property">
            <p>The BlockFinaX interface, branding, and non-smart-contract software are the intellectual property of BlockFinaX Inc. The smart contracts are open-source and governed by their respective licences. You may not reproduce, redistribute, or create derivative works from the interface without prior written consent.</p>
          </Section>

          <Section title="10. Limitation of Liability">
            <p>To the maximum extent permitted by applicable law, BlockFinaX and its contributors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of funds, profits, data, or goodwill, arising from your use of the protocol.</p>
            <p>Our total aggregate liability, if any, shall not exceed the protocol fees you paid in the 30 days preceding the event giving rise to the claim.</p>
          </Section>

          <Section title="11. No Warranties">
            <p>The protocol is provided "as is" and "as available" without any warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the protocol will be uninterrupted, error-free, or free of harmful components.</p>
          </Section>

          <Section title="12. Amendments">
            <p>We may update these Terms at any time. When we do, we will increment the version number and prompt existing users to re-accept. Continued use of the protocol after a new version is published constitutes acceptance of the updated Terms.</p>
          </Section>

          <Section title="13. Governing Law">
            <p>These Terms shall be governed by and construed in accordance with applicable law. Any disputes arising under these Terms shall be resolved by binding arbitration, except where prohibited by law.</p>
          </Section>

          <Section title="14. Contact">
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
