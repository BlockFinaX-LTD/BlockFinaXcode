import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Lock } from "lucide-react";

const EFFECTIVE_DATE = "1 July 2026";
const VERSION = "1.0";

export default function PrivacyPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 pb-16">
        <div className="flex items-center gap-3 mb-8">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Privacy Policy</h1>
          </div>
        </div>

        <div className="space-y-6 text-sm">
          <div className="bg-muted/50 rounded-xl p-4 border border-border text-muted-foreground">
            <p><strong>Version {VERSION}</strong> · Effective {EFFECTIVE_DATE}</p>
            <p className="mt-1">This policy explains what data BlockFinaX collects, why, and how it is handled.</p>
          </div>

          <Section title="1. Who We Are">
            <p>BlockFinaX Ltd ("BlockFinaX", "we", "us", "our") operates the BlockFinaX decentralised P2P hedging protocol and the interface accessible at this domain. This Privacy Policy applies to data collected through our interface and API. It does not apply to data recorded on public blockchains, which is inherently public and outside our control.</p>
          </Section>

          <Section title="2. Data We Collect">
            <p>We collect only what is necessary to operate the protocol interface:</p>
            <ul>
              <li><strong>Wallet address.</strong> Your blockchain wallet address, used to identify your session, record protocol activity, and associate any accepted terms.</li>
              <li><strong>Email address (optional).</strong> If you voluntarily provide an email during wallet creation, it is stored and may be used to send protocol updates or security notices. Providing an email is never required to use the protocol.</li>
              <li><strong>Usage data.</strong> Standard server logs including IP address, browser type, pages visited, and timestamps. Retained for up to 90 days for security and debugging purposes.</li>
              <li><strong>Terms acceptance record.</strong> When you accept our Terms of Use, we record your wallet address, the version accepted, and the timestamp as a legal audit trail.</li>
              <li><strong>Referral codes.</strong> If you use or generate a referral code, the association between referrer and referred wallet address is stored.</li>
            </ul>
            <p>We do not collect government IDs, payment card details, or traditional KYC documentation. We do not run behavioural advertising or sell data to third parties.</p>
          </Section>

          <Section title="3. How We Use Your Data">
            <ul>
              <li>To operate and secure the protocol interface.</li>
              <li>To record legally required consent (Terms of Use acceptance).</li>
              <li>To send protocol-related communications if you have provided an email address.</li>
              <li>To detect and prevent fraud, abuse, and unauthorised access.</li>
              <li>To comply with applicable legal obligations.</li>
            </ul>
          </Section>

          <Section title="4. Legal Basis for Processing (GDPR)">
            <p>Where the General Data Protection Regulation (GDPR) applies, we process your data on the following bases:</p>
            <ul>
              <li><strong>Contractual necessity</strong> — processing your wallet address and session data is necessary to provide the service you requested.</li>
              <li><strong>Legal obligation</strong> — recording terms acceptance and maintaining security logs.</li>
              <li><strong>Legitimate interests</strong> — fraud prevention and service security.</li>
              <li><strong>Consent</strong> — where you have voluntarily provided an email address.</li>
            </ul>
          </Section>

          <Section title="5. On-Chain Data">
            <p>Transactions you submit through the protocol are recorded permanently on Base and BNB Smart Chain and are publicly visible. This includes wallet addresses, transaction amounts, contract interactions, and timestamps. BlockFinaX has no ability to alter or delete on-chain data. This data is outside the scope of this Privacy Policy.</p>
          </Section>

          <Section title="6. Data Sharing">
            <p>We do not sell, rent, or trade your personal data. We may share data only in the following limited circumstances:</p>
            <ul>
              <li><strong>Service providers.</strong> Infrastructure providers (database hosting, server providers) who process data on our behalf under binding data processing agreements.</li>
              <li><strong>Legal requirements.</strong> If required by applicable law, court order, or regulatory authority.</li>
              <li><strong>Business transfers.</strong> In the event of a merger, acquisition, or sale of assets, your data may be transferred as part of that transaction with equivalent privacy protections maintained.</li>
            </ul>
          </Section>

          <Section title="7. Data Retention">
            <ul>
              <li>Wallet and session data: retained for the duration of protocol operation and up to 3 years thereafter for legal compliance.</li>
              <li>Email addresses: retained until you request deletion or withdraw consent.</li>
              <li>Server logs: 90 days.</li>
              <li>Terms acceptance records: retained indefinitely as a legal audit trail.</li>
            </ul>
          </Section>

          <Section title="8. Your Rights">
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data (where not required for legal compliance).</li>
              <li>Withdraw consent for email communications at any time.</li>
              <li>Lodge a complaint with your local data protection authority.</li>
            </ul>
            <p>To exercise any of these rights, contact us at <a href="mailto:anthonykumako8@gmail.com" className="text-primary underline">anthonykumako8@gmail.com</a>.</p>
          </Section>

          <Section title="9. Security">
            <p>Private keys are encrypted with AES-256 and stored only in your browser's local storage — they are never transmitted to or stored on our servers. We implement industry-standard security measures including rate limiting, HTTPS encryption, and session-based access controls. No method of transmission or storage is completely secure; you use the protocol at your own risk.</p>
          </Section>

          <Section title="10. Children">
            <p>The BlockFinaX protocol is not directed at persons under 18 years of age. We do not knowingly collect personal data from minors. If you believe a minor has provided us with personal data, please contact us and we will delete it.</p>
          </Section>

          <Section title="11. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. When we do, we will update the version number and effective date at the top of this page. Continued use of the protocol after changes are published constitutes acceptance of the updated policy.</p>
          </Section>

          <Section title="12. Contact">
            <p>For privacy-related questions or requests, contact us at <a href="mailto:anthonykumako8@gmail.com" className="text-primary underline">anthonykumako8@gmail.com</a>.</p>
          </Section>

          <div className="border-t border-border pt-6 text-xs text-muted-foreground">
            <p>BlockFinaX Privacy Policy · Version {VERSION} · Effective {EFFECTIVE_DATE}</p>
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
