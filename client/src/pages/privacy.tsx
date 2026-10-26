import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Lock } from "lucide-react";

const EFFECTIVE_DATE = "8 August 2026";
const VERSION = "1.3";

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
            <p>BlockFinaX Inc. ("BlockFinaX", "we", "us", "our") operates the BlockFinaX decentralised P2P hedging protocol and the interface accessible at this domain. This Privacy Policy applies to data collected through our interface and API. It does not apply to data recorded on public blockchains, which is inherently public and outside our control.</p>
            <p className="mt-2"><strong>Our group.</strong> BlockFinaX Inc. is a corporation incorporated in the State of Delaware, United States, with its registered office at 1007 N Orange St, 4th Floor #5543, Wilmington, DE 19801, USA. It is the parent company and the entity you contract with. BlockFinaX Ltd is a company registered in Ghana and is its wholly-owned operating subsidiary, through which operations in Ghana are carried out.</p>
            <p className="mt-2"><strong>Who controls your data.</strong> BlockFinaX Inc. is the data controller for the personal data described in this policy. Your data may be accessed and processed by BlockFinaX Ltd as part of the same group, under arrangements requiring it to protect your data to the standard set out here. Wherever this policy says "BlockFinaX", it means both companies.</p>
          </Section>

          <Section title="2. Data We Collect">
            <p>We collect only what is necessary to operate the protocol interface:</p>
            <ul>
              <li><strong>Wallet address.</strong> Your blockchain wallet address, used to identify your session, record protocol activity, and associate any accepted terms.</li>
              <li><strong>Email address (optional).</strong> If you voluntarily provide an email during wallet creation, it is stored and may be used to send protocol updates or security notices. Providing an email is never required to use the protocol.</li>
              <li><strong>Usage data.</strong> Standard server logs including IP address, browser type, pages visited, and timestamps. Retained for up to 90 days for security and debugging purposes.</li>
              <li><strong>Terms acceptance record.</strong> When you accept our Terms of Use, we record your wallet address, the version accepted, and the timestamp as a legal audit trail.</li>
              <li><strong>Referral codes.</strong> If you use or generate a referral code, the association between referrer and referred wallet address is stored.</li>
              <li><strong>Assistant conversations.</strong> Messages you exchange with Finax, our on-site assistant, are stored so the conversation persists across a page reload and so we can review answer quality. Public conversations are associated with a hashed browser identifier, not with your name or your IP address. Do not send personal or confidential information to the assistant.</li>
              <li><strong>Contact details you volunteer (optional).</strong> If you complete the follow-up form the assistant may offer, we store the name and email you enter, the exact consent wording shown to you, and the time you agreed. We use this only to send you the follow-up described on that form. It is never collected from the text of a conversation, and providing it is never required.</li>
            </ul>
            <p>We do not collect government IDs, payment card details, or traditional KYC documentation. We do not run behavioural advertising or sell data to third parties.</p>
          </Section>

          <Section title="3. How We Use Your Data">
            <ul>
              <li>To operate and secure the protocol interface.</li>
              <li>To record legally required consent (Terms of Use acceptance).</li>
              <li>To send protocol-related communications if you have provided an email address.</li>
              <li>To send you information about our services, only where you have explicitly asked us to via the follow-up form, and only until you unsubscribe.</li>
              <li>To operate and improve the on-site assistant.</li>
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

          <Section title="6a. International Transfers">
            <p>BlockFinaX Inc. is established in the United States and BlockFinaX Ltd in Ghana. If you are in the European Economic Area or the United Kingdom, using our service therefore involves transferring your personal data outside that region, to countries which have not received an adequacy decision.</p>
            <p>Where such a transfer takes place, it is made either with your explicit consent or because it is necessary to perform the contract you have entered into with us. We apply the same protections described in this policy to your data wherever it is held.</p>
          </Section>

          <Section title="7. Data Retention">
            <ul>
              <li>Wallet and session data: retained for the duration of protocol operation and up to 3 years thereafter for legal compliance.</li>
              <li>Email addresses: retained until you request deletion or withdraw consent.</li>
              <li>Server logs: 90 days.</li>
              <li>Assistant conversations: 12 months, then deleted.</li>
              <li>Follow-up contact details: retained until you unsubscribe or ask us to delete them. The record that you consented, and the wording you agreed to, is kept for 6 years after that as proof that we had permission to contact you — this is the only part we keep, and it is kept because data protection law requires us to be able to demonstrate consent.</li>
              <li>Terms acceptance records: retained indefinitely as a legal audit trail.</li>
            </ul>
          </Section>

          <Section title="8. Your Rights">
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data (where not required for legal compliance).</li>
              <li>Withdraw consent for email communications at any time — every marketing email we send carries a one-click unsubscribe link, and unsubscribing takes effect immediately without you needing to contact us.</li>
              <li>Object to your data being used for direct marketing.</li>
              <li>Lodge a complaint with your local data protection authority.</li>
            </ul>
            <p>To exercise any of these rights, contact us at <a href="mailto:hello@blockfinax.com" className="text-primary underline">hello@blockfinax.com</a>. We will respond within 30 days.</p>
          </Section>

          <Section title="9. Security">
            <p><strong>Wallet keys.</strong> Your wallet is a smart account controlled by a passkey that is created and stored on your own device and unlocked with its fingerprint, face or PIN. BlockFinaX never receives, transmits, or stores your passkey's private key, and cannot move funds from your wallet: a transaction happens only when you approve it with your passkey. Signing in with your email or Google account identifies you but cannot move funds.</p>
            <p className="mt-2">We implement industry-standard security measures including rate limiting, HTTPS encryption, and session-based access controls. No method of transmission or storage is completely secure; you use the protocol at your own risk.</p>
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
