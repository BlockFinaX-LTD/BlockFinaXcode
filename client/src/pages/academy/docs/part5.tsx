import { KV, KVRow, P, Section, Table, UL } from '../lesson-blocks';
import { A, Head } from './common';

const PART = 'Help and reference';

const QA: [string, React.ReactNode][] = [
  ['Is protection the same as insurance?', 'No claim is assessed. The contract pays a fixed calculation on the reference rate, whatever loss you actually had, and pays nothing if the rate does not pass your strike.'],
  ['What happens to my premium if there is no payout?', 'It stays with the underwriters who backed the contract. It is the price of having been protected.'],
  ['Can I protect several payments?', 'Yes. Buy a separate contract for each amount and date; each runs independently.'],
  ['What if my end date is a public holiday?', 'Only weekends move the end date, to the following Monday. Public holidays do not, so the reference rate on that day is used.'],
  ['Do I need experience with crypto?', 'No. You sign in with email or Google, approve with a passkey and hold USDC. BlockFinaX pays network fees.'],
  ['Can I check a contract independently?', <>Yes. Every purchase, settlement and claim is a transaction on the Stellar ledger and can be viewed in a Stellar explorer such as stellar.expert. The test network pool contract is CAEKJTUSZIWY5OMK6EVOSNPMEULI3MDO3BLP6Y5OKPHRNKM6KTH5YURM.</>],
  ['What happens if BlockFinaX stops operating?', 'Balances and contracts stay in the pool contract on Stellar. Settlement needs the rate operators to report, and the app is currently the only supported way to submit transactions.'],
  ['Who are the underwriters?', 'Anyone with a BlockFinaX account can underwrite. Each pool shows its creator\'s wallet address.'],
];

export function Faq() {
  return (
    <>
      <Head part={PART} title="Common questions">Short answers to questions the other pages leave open.</Head>
      <Section n="01" id="questions" title="Questions">
        <KV>{QA.map(([q, a]) => <KVRow key={q} term={q}>{a}</KVRow>)}</KV>
      </Section>
    </>
  );
}

const TERMS: [string, string][] = [
  ['Amount (notional)', 'The dollar amount a contract protects.'],
  ['Appreciation cover', 'The underwriter side of receivables protection: it pays out if the local currency strengthens past the strike.'],
  ['Cap', 'In capped cover, the rate beyond which the payout stops growing.'],
  ['Capped cover', 'Protection whose payout stops at a cap the buyer chooses.'],
  ['Depreciation cover', 'The underwriter side of payables protection: it pays out if the local currency weakens past the strike.'],
  ['End date', 'The date a contract ends, at 14:00 UTC, moved to Monday if it falls on a weekend.'],
  ['Execution cost', 'The 5% platform fee on the premium for direct purchases.'],
  ['Fair rate', 'The price per dollar protected calculated by BlockFinaX\'s pricing engine, before the pool\'s markup.'],
  ['Free capital', 'Underwriting capital not reserved for running contracts, available to back new sales or withdraw.'],
  ['Markup', 'The multiple of the fair rate a pool charges, set by the pool creator.'],
  ['Open cover', 'Protection whose maximum payout is a percentage of the amount set by the pool.'],
  ['Passkey', 'A credential on your device, approved with your fingerprint, face or PIN, used to approve every transaction.'],
  ['Payables protection', 'Protection for dollars you have to pay; pays if the local currency weakens past your strike.'],
  ['Pool', 'Underwriters\' USDC that backs protection for one currency in one direction.'],
  ['Pool creator', 'The underwriter who opened a pool and sets its terms.'],
  ['Premium', 'The price of a contract, paid once at purchase.'],
  ['Rate operator', 'A party that reports the reference rate after a contract ends.'],
  ['Receivables protection', 'Protection for dollars you will receive; pays if the local currency strengthens past your strike.'],
  ['Reference rate', 'The published USD exchange rate a contract settles on.'],
  ['Request a quote', 'Asking underwriters to price cover that no open pool offers.'],
  ['Reserve', 'The maximum payout of a contract, set aside from underwriters when it is sold.'],
  ['Settlement', 'Recording the agreed rate for a contract and fixing its payout.'],
  ['Strike', 'The rate at which the payout starts.'],
  ['Underwriter', 'Someone who provides USDC to a pool, earns premiums and pays payouts.'],
  ['USDC', 'A US dollar stablecoin issued by Circle, the only asset used in BlockFinaX.'],
];

export function Glossary() {
  return (
    <>
      <Head part={PART} title="Glossary">Terms used in the app and in this guide.</Head>
      <Section n="01" id="terms" title="Terms">
        <KV>{TERMS.map(([t, d]) => <KVRow key={t} term={t}>{d}</KVRow>)}</KV>
      </Section>
    </>
  );
}

export function Troubleshooting() {
  return (
    <>
      <Head part={PART} title="Troubleshooting">The messages you may see, what they mean and what to do next.</Head>

      <Section n="01" id="quotes" title="Quotes">
        <Table
          head={['Message', 'Meaning and next step']}
          rows={[
            ['No pool is offering 30-day capped rising-rate protection on USD/GHS. Request a quote instead. (with your own terms)', 'No open pool sells these terms. Change the end date, structure or direction, or request a quote.'],
            ['Not enough free liquidity for that amount', 'The pool\'s free capital is smaller than the maximum payout. Lower the amount, narrow the cap or request a quote.'],
            ['Protection must start at least X% from today\'s rate for this cover', 'The pool sets a minimum distance for the strike. Move the strike further from today\'s rate.'],
            ['This protection is too cheap for what it could pay', 'The maximum payout is more than 100 times the premium. Move the strike closer to today\'s rate or lower the cap.'],
            ['This strike is too far from today\'s rate to price', 'The premium would be zero. Move the strike closer or choose a longer duration.'],
            ['Pricing for this currency is updating', 'The rate history is being refreshed. Try again in a few minutes.'],
          ]}
        />
      </Section>

      <Section n="02" id="transactions" title="Transactions">
        <Table
          head={['Situation', 'Next step']}
          rows={[
            ['Not enough USDC. This needs $X USDC. Add funds first.', 'Add USDC to your wallet, then confirm again.'],
            ['The button shows Refresh price', 'The 120-second quote has nearly expired. Select it to get a new price.'],
            ['This transaction would cost far more in network fees than normal, so it was not sent.', 'Nothing was charged. Try again; if it repeats, contact support with the time.'],
            ['Protection not placed', 'The transaction did not complete and no funds moved. The message explains the reason.'],
            ['A deposit from Base has not arrived', 'Transfers usually complete within minutes. Check that you sent USDC on Base to your personal deposit address and at least 1 USDC.'],
          ]}
        />
      </Section>

      <Section n="03" id="sign-in" title="Signing in">
        <UL>
          <li>If your browser offers a QR code instead of your passkey, you are on a device or address where the passkey is not saved. Use the device where you created it, or sign in with your email code and add a backup passkey.</li>
          <li>Closing the tab signs you out. This is expected.</li>
        </UL>
      </Section>

      <Section n="04" id="settlement" title="Settlement">
        <P>
          Settlement usually completes within minutes of the end time. If a contract still shows as active more than an hour after
          its end time, contact support with the contract's ID.
        </P>
      </Section>
    </>
  );
}

export function Support() {
  return (
    <>
      <Head part={PART} title="Contact and support">
        Ask the in-app assistant, email hello@blockfinax.com or use the Contact page.
      </Head>
      <Section n="01" id="channels" title="Channels">
        <UL>
          <li>Ask BlockFinaX: the assistant in the app answers questions about quotes, currencies and payouts.</li>
          <li>Email: hello@blockfinax.com.</li>
          <li>Contact page: <a href="/contact" className="ac-link">blockfinax.com/contact</a>, with an enquiry type so your message reaches the right person.</li>
        </UL>
      </Section>
      <Section n="02" id="include" title="What to include">
        <UL>
          <li>The email address you sign in with.</li>
          <li>Your wallet address, shown under Wallet, if your question is about funds.</li>
          <li>The contract, pool or transaction concerned, and the time it happened.</li>
          <li>A screenshot of any message.</li>
        </UL>
        <P>
          BlockFinaX will never ask for your passkey, a recovery phrase or a private key, and cannot use them on your behalf.
          See also <A to="troubleshooting">Troubleshooting</A>.
        </P>
      </Section>
    </>
  );
}
