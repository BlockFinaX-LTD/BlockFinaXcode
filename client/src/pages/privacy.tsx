import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Lock } from "lucide-react";

const EFFECTIVE_DATE = "4 November 2026";
const VERSION = "1.4";

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
            <p className="mt-1">This policy explains what data BlockFinaX collects, why, who it is shared with, and how long it is kept.</p>
          </div>

          <Section title="1. Who We Are">
            <p>BlockFinaX Inc. ("BlockFinaX", "we", "us", "our") operates the BlockFinaX currency protection protocol and the interface accessible at this domain. This Privacy Policy applies to data collected through our interface and API. Data recorded on public blockchains is described in section 5.</p>
            <p className="mt-2"><strong>Our group.</strong> BlockFinaX Inc. is a corporation incorporated in the State of Delaware, United States, with its registered office at 1007 N Orange St, 4th Floor #5543, Wilmington, DE 19801, USA. It is the parent company and the entity you contract with. BlockFinaX Ltd is a company registered in Ghana and is its wholly-owned operating subsidiary, through which operations in Ghana are carried out.</p>
            <p className="mt-2"><strong>Who controls your data.</strong> BlockFinaX Inc. is the data controller for the personal data described in this policy. Your data may be accessed and processed by BlockFinaX Ltd as part of the same group, under arrangements requiring it to protect your data to the standard set out here. Wherever this policy says "BlockFinaX", it means both companies.</p>
          </Section>

          <Section title="2. Data We Collect">
            <ul>
              <li><strong>Account details.</strong> Your email address, which you need to sign in. If you sign in with Google, we also receive your name and profile picture from Google.</li>
              <li><strong>Passkey details.</strong> The public key and identifier of each passkey you create, and any name you give it (for example "Work phone"). We never receive or store a passkey's private key.</li>
              <li><strong>Wallet addresses.</strong> Your Stellar wallet address and any deposit addresses created for you on other networks, used to show your balances and record your activity.</li>
              <li><strong>Business account details.</strong> If you create or join a business account: the business's name, its account address, each member's email address, role and status, invitations sent (the invited person's email address, and a one-time invitation code we store only in scrambled form), and a history of changes to its members with the related transaction references.</li>
              <li><strong>Verification details.</strong> To transact, you provide the details your verification tier requires, which may include your full legal name, phone number, country of residence, Ghana Card or passport number, date of birth, photo identity document, proof of address and a source of funds declaration. For a business: a certificate of incorporation, a directors and shareholders register, a beneficial ownership declaration and a source of wealth declaration. We also keep the results of sanctions screening and transaction reviews.</li>
              <li><strong>Usage data.</strong> Standard server logs including IP address, browser type, pages visited and timestamps.</li>
              <li><strong>Terms acceptance record.</strong> Where you accept our Terms of Use, we record the version accepted and when.</li>
              <li><strong>Referral codes.</strong> If you use or generate a referral code, the link between the referrer and the person referred.</li>
              <li><strong>Assistant conversations.</strong> Messages you exchange with Finax, our on-site assistant, are stored so the conversation persists across a page reload and so we can review answer quality. Public conversations are associated with a scrambled browser identifier, not with your name or your IP address. Do not send personal or confidential information to the assistant.</li>
              <li><strong>Contact details you volunteer (optional).</strong> If you complete the follow-up form the assistant may offer, we store the name and email you enter, the exact consent wording shown to you, and the time you agreed. We use this only to send you the follow-up described on that form. It is never collected from the text of a conversation, and providing it is never required.</li>
            </ul>
            <p>We do not collect payment card details. We do not run behavioural advertising or sell data to third parties.</p>
          </Section>

          <Section title="3. How We Use Your Data">
            <ul>
              <li>To provide your account, wallet and any business accounts you belong to, including sending invitations an admin asks us to send.</li>
              <li>To verify identity, screen against sanctions lists, set transaction limits and meet our anti-money laundering obligations.</li>
              <li>To record legally required consent, such as acceptance of our Terms of Use.</li>
              <li>To send you service messages, such as sign-in codes, verification updates and security notices.</li>
              <li>To send you information about our services, only where you have explicitly asked us to via the follow-up form, and only until you unsubscribe.</li>
              <li>To operate and improve the on-site assistant.</li>
              <li>To detect and prevent fraud, abuse and unauthorised access.</li>
              <li>To comply with other applicable legal obligations.</li>
            </ul>
          </Section>

          <Section title="4. Legal Basis for Processing (GDPR)">
            <p>Where the General Data Protection Regulation (GDPR) applies, we process your data on the following bases:</p>
            <ul>
              <li><strong>Contractual necessity:</strong> your account, passkey, wallet and business account details, which are needed to provide the service you asked for.</li>
              <li><strong>Legal obligation:</strong> verification, sanctions screening, transaction monitoring and their records, terms acceptance records and security logs.</li>
              <li><strong>Legitimate interests:</strong> fraud prevention and service security, and sending an invitation to a person a business admin has chosen to invite.</li>
              <li><strong>Consent:</strong> follow-up contact you request through the assistant.</li>
            </ul>
          </Section>

          <Section title="5. On-Chain Data">
            <p>Transactions you approve are recorded permanently on public blockchains, mainly Stellar, and on any other network you fund from or withdraw to, such as Base. This includes wallet addresses, amounts, contract interactions and timestamps, and anyone can see it.</p>
            <p>Your wallet's passkey public key is recorded on Stellar as its signer. If you are a member of a business account, your passkey's public key and identifier are also recorded on Stellar as a signer of that account. Removing a member takes their passkey off the account from then on, but the history remains visible on chain.</p>
            <p>BlockFinaX cannot alter or delete on-chain data. It is outside the scope of the rights in section 10.</p>
          </Section>

          <Section title="6. Who Can See Your Data">
            <ul>
              <li><strong>Members of your business accounts.</strong> Other members of a business account you belong to can see your email address, your role and status, and the history of changes you made to its members. Admins also see invitations they or other admins have sent.</li>
              <li><strong>Regulators and authorities.</strong> Verification documents are shared only with regulators or authorities who ask for them, or where required by law, court order or regulatory authority.</li>
              <li><strong>Business transfers.</strong> In a merger, acquisition or sale of assets, your data may be transferred as part of that transaction with equivalent privacy protections maintained.</li>
            </ul>
            <p>We do not sell, rent or trade your personal data.</p>
          </Section>

          <Section title="7. Service Providers">
            <p>We use providers who process data on our behalf, only for these purposes:</p>
            <ul>
              <li><strong>Hosting and databases</strong> (Railway): run the app and store the data described here.</li>
              <li><strong>Email delivery</strong> (Resend): sign-in codes, invitations, verification updates and service messages.</li>
              <li><strong>Sign-in with Google</strong> (Google), if you choose it.</li>
              <li><strong>On-site assistant</strong> (Anthropic): processes assistant conversations to generate replies.</li>
              <li><strong>Transaction submission</strong> (OpenZeppelin Relayer Channels): receives the transactions you approve so it can submit them and pay the network fee.</li>
              <li><strong>Blockchain access</strong> (Stellar network data providers, and on Base, Coinbase and Pimlico for fee sponsorship): read balances and submit transactions.</li>
              <li><strong>Moving USDC between networks</strong> (Circle): transfers you start between Base and Stellar.</li>
            </ul>
            <p>Sanctions screening is carried out on our own systems against public sanctions lists; your verification details are not sent to a screening provider.</p>
          </Section>

          <Section title="8. International Transfers">
            <p>BlockFinaX Inc. is established in the United States and BlockFinaX Ltd in Ghana, and some of the providers above process data in other countries. If you are in the European Economic Area or the United Kingdom, using our service therefore involves transferring your personal data outside that region, to countries which have not received an adequacy decision.</p>
            <p>Where such a transfer takes place, it is made either with your explicit consent or because it is necessary to perform the contract you have entered into with us. We apply the same protections described in this policy to your data wherever it is held.</p>
          </Section>

          <Section title="9. Data Retention">
            <ul>
              <li>Account, passkey, wallet and business account details: for as long as the account exists, and up to 3 years afterwards for legal compliance.</li>
              <li>Verification details, screening results and transaction records: 6 years after our relationship ends, as required by the Anti-Money Laundering Act, 2020 (Act 1044).</li>
              <li>Invitations: an unused invitation code expires after 7 days. The record that someone was invited is kept with the business account's history.</li>
              <li>Server logs: 90 days.</li>
              <li>Assistant conversations: 12 months, then deleted.</li>
              <li>Follow-up contact details: retained until you unsubscribe or ask us to delete them. The record that you consented, and the wording you agreed to, is kept for 6 years after that as proof that we had permission to contact you. This is the only part we keep, and it is kept because data protection law requires us to be able to demonstrate consent.</li>
              <li>Terms acceptance records: retained indefinitely as a legal audit trail.</li>
            </ul>
          </Section>

          <Section title="10. Your Rights">
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data, where we are not required to keep it by law.</li>
              <li>Withdraw consent for marketing emails at any time. Every marketing email we send carries a one-click unsubscribe link, and unsubscribing takes effect immediately without you needing to contact us.</li>
              <li>Object to your data being used for direct marketing.</li>
              <li>Lodge a complaint with your local data protection authority.</li>
            </ul>
            <p>If you are a member of a business account, ask one of its admins to remove you. Data that records your past actions for the business is kept with its history, as described above.</p>
            <p>To exercise any of these rights, contact us at <a href="mailto:hello@blockfinax.com" className="text-primary underline">hello@blockfinax.com</a>. We will respond within 30 days.</p>
          </Section>

          <Section title="11. Security">
            <p><strong>Wallet keys.</strong> Your wallet is a smart account controlled by a passkey that is created and stored on your own device and unlocked with its fingerprint, face or PIN. BlockFinaX never receives, transmits or stores your passkey's private key, and cannot move funds from your wallet: a transaction happens only when you approve it with your passkey. Signing in with your email or Google account identifies you but cannot move funds.</p>
            <p className="mt-2"><strong>Business accounts.</strong> A business account's transactions are approved only by its members' own passkeys, within their roles. BlockFinaX cannot sign for a business account either.</p>
            <p className="mt-2">We use industry-standard measures including encryption in transit, rate limiting and session-based access controls. No method of transmission or storage is completely secure; you use the protocol at your own risk.</p>
          </Section>

          <Section title="12. Children">
            <p>BlockFinaX is not directed at persons under 18 years of age. We do not knowingly collect personal data from minors. If you believe a minor has provided us with personal data, please contact us and we will delete it.</p>
          </Section>

          <Section title="13. Changes to This Policy">
            <p>We may update this Privacy Policy from time to time. When we do, we will update the version number and effective date at the top of this page, and tell you about material changes in the app or by email. Continued use of the protocol after changes are published constitutes acceptance of the updated policy.</p>
          </Section>

          <Section title="14. Contact">
            <p>For privacy questions or requests, contact us at <a href="mailto:hello@blockfinax.com" className="text-primary underline">hello@blockfinax.com</a>.</p>
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
