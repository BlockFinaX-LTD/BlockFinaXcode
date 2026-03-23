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
            <p>BlockFinaX is a decentralised peer-to-peer (P2P) hedging protocol built on the Lisk Layer 2 blockchain network. The protocol enables users to create, buy, and provide liquidity for one-touch FX and commodity protection contracts governed entirely by open-source smart contracts.</p>
            <p>BlockFinaX Ltd and its contributors (collectively "BlockFinaX", "we", "us") develop and maintain the smart contract infrastructure and the interface at this domain. We do not operate as a counterparty, broker, exchange, or financial intermediary in any transaction executed through the protocol.</p>
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

          <Section title="3. Nature of the Protocol">
            <p>The BlockFinaX protocol is non-custodial and decentralised. This means:</p>
            <ul>
              <li><strong>You control your funds.</strong> All assets are held in audited smart contracts on-chain, not by BlockFinaX.</li>
              <li><strong>Smart contracts are immutable once deployed.</strong> Transactions are final and cannot be reversed by BlockFinaX or any third party.</li>
              <li><strong>The protocol streams reference prices from external oracles.</strong> No physical delivery of any underlying asset (currency, commodity, or cryptocurrency) ever occurs. All settlements are cash-settled in USDC.</li>
              <li><strong>The protocol is peer-to-peer.</strong> Hedgers and liquidity providers transact directly with one another through smart contracts. BlockFinaX does not match orders or act as a market maker.</li>
            </ul>
          </Section>

          <Section title="4. Risk Disclosures">
            <p>Use of the protocol involves significant risks. You acknowledge and accept the following:</p>
            <ul>
              <li><strong>Smart contract risk.</strong> Despite security audits, smart contracts may contain bugs or vulnerabilities that could result in the partial or total loss of funds.</li>
              <li><strong>Oracle risk.</strong> Price feeds used for settlement are sourced from third-party providers. Oracle manipulation, latency, or failure could result in incorrect or missed settlements.</li>
              <li><strong>FX and market risk.</strong> The value of reference assets can move dramatically, resulting in the loss of premiums paid or capital deposited.</li>
              <li><strong>Liquidity risk.</strong> Liquidity pools may be insufficient to cover payouts in extreme market conditions.</li>
              <li><strong>Regulatory risk.</strong> The regulatory status of decentralised protocols varies by jurisdiction and may change. You are solely responsible for ensuring your use complies with applicable law.</li>
              <li><strong>Technology risk.</strong> Network congestion, wallet errors, or software bugs may cause transactions to fail or settle at unintended prices.</li>
            </ul>
          </Section>

          <Section title="5. No Financial Advice">
            <p>Nothing on the BlockFinaX interface or in any associated communication constitutes financial, investment, legal, or tax advice. You should conduct your own due diligence and consult qualified advisors before using the protocol.</p>
          </Section>

          <Section title="6. Fees">
            <p>The protocol charges the following fees, which are applied automatically by smart contracts:</p>
            <ul>
              <li>Event creation fee: $25 flat</li>
              <li>Hedger entry fee: 0.5% of notional</li>
              <li>Payout fee: 1% deducted at claim</li>
              <li>Liquidity provider profit fee: 1% deducted at claim</li>
              <li>Creator loyalty fee: 5% share of all protocol fees on their event</li>
              <li>Wallet transfer fee: 0.3% (minimum $0.50)</li>
            </ul>
            <p>All fees are non-refundable once a transaction is submitted to the blockchain.</p>
          </Section>

          <Section title="7. Prohibited Uses">
            <p>You agree not to use the protocol to:</p>
            <ul>
              <li>Violate any applicable law or regulation.</li>
              <li>Engage in market manipulation, wash trading, or any form of fraud.</li>
              <li>Launder money or finance any illegal activity.</li>
              <li>Circumvent sanctions or export control regulations.</li>
              <li>Conduct any activity that could damage, disable, or impair the protocol or its underlying infrastructure.</li>
            </ul>
          </Section>

          <Section title="8. Intellectual Property">
            <p>The BlockFinaX interface, branding, and non-smart-contract software are the intellectual property of BlockFinaX Ltd. The smart contracts are open-source and governed by their respective licences. You may not reproduce, redistribute, or create derivative works from the interface without prior written consent.</p>
          </Section>

          <Section title="9. Limitation of Liability">
            <p>To the maximum extent permitted by applicable law, BlockFinaX and its contributors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of funds, profits, data, or goodwill, arising from your use of the protocol.</p>
            <p>Our total aggregate liability, if any, shall not exceed the protocol fees you paid in the 30 days preceding the event giving rise to the claim.</p>
          </Section>

          <Section title="10. No Warranties">
            <p>The protocol is provided "as is" and "as available" without any warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the protocol will be uninterrupted, error-free, or free of harmful components.</p>
          </Section>

          <Section title="11. Amendments">
            <p>We may update these Terms at any time. When we do, we will increment the version number and prompt existing users to re-accept. Continued use of the protocol after a new version is published constitutes acceptance of the updated Terms.</p>
          </Section>

          <Section title="12. Governing Law">
            <p>These Terms shall be governed by and construed in accordance with applicable law. Any disputes arising under these Terms shall be resolved by binding arbitration, except where prohibited by law.</p>
          </Section>

          <Section title="13. Contact">
            <p>For questions regarding these Terms, please contact us at <a href="mailto:anthonykumako8@gmail.com" className="text-primary underline">anthonykumako8@gmail.com</a>.</p>
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
