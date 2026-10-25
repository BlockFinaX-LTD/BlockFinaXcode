import { H1, KV, KVRow, Lead, LessonTag, Section } from '../lesson-blocks';

const BFX: [string, string][] = [
  ['Payables protection', 'Cover for dollars you have to pay; it pays if your currency weakens past your strike.'],
  ['Receivables protection', 'Cover for dollars you will receive; it pays if your currency strengthens past your strike.'],
  ['Depreciation cover', "The underwriter's side of payables protection."],
  ['Appreciation cover', "The underwriter's side of receivables protection."],
  ['Strike', 'The exchange rate where protection starts paying.'],
  ['Cap', 'The rate where the payout stops rising.'],
  ['Capped cover', 'Protection that stops at the cap you choose.'],
  ['Open cover', 'Protection whose maximum is set by the pool as a share of the amount.'],
  ['Premium', 'The price of protection, paid once when you buy.'],
  ['End date', 'The day the rate is checked, at 14:00 UTC; weekends move to Monday.'],
  ['Pool', 'USDC from underwriters that backs protection for one currency and one direction.'],
  ['Reserve', 'The most a protection can pay, set aside from the pool when it is sold.'],
  ['Rate operator', 'An independent party that reports the exchange rate at the end date.'],
  ['Settlement', 'Fixing the payout from the agreed rate.'],
  ['Passkey', 'Your fingerprint, face or device code, used to approve every payment.'],
  ['USDC', 'A digital dollar issued by Circle; the only money used in BlockFinaX.'],
  ['Request a quote', 'Asking underwriters to price cover that no open pool offers.'],
];
const FX: [string, string][] = [
  ['Currency risk', 'The chance that an exchange-rate move changes what you pay or receive.'],
  ['Hard currency', 'A widely traded currency, such as the US dollar or euro.'],
  ['Depreciation', 'A currency losing value against another.'],
  ['Hedge', 'An arrangement that offsets a loss from a price move.'],
  ['Forward', 'An agreement to exchange currency at a fixed rate on a future date.'],
  ['NDF', 'A forward settled in a convertible currency, with no local currency exchanged.'],
  ['Swap', 'An exchange of currencies at the start and again at the end of a contract.'],
  ['Future', 'A standardised forward traded on an exchange.'],
  ['Option', 'The right, but not the obligation, to exchange at a fixed rate, for a premium.'],
  ['Tenor', 'How long a contract runs.'],
  ['Rolling hedge', 'A series of short contracts renewed as each ends.'],
  ['Rollover risk', 'The risk that the next contract in a roll costs more or is unavailable.'],
  ['Volatility', 'How much a rate tends to move; higher volatility makes protection cost more.'],
];

export default function Cheatsheet() {
  return (
    <>
      <LessonTag>Lesson 12 · Understanding FX risk</LessonTag>
      <H1>Glossary</H1>
      <Lead>Every term used in the Academy, in one line each.</Lead>
      <Section n="01" id="blockfinax" title="BlockFinaX terms">
        <KV>{BFX.map(([t, d]) => <KVRow key={t} term={t}>{d}</KVRow>)}</KV>
      </Section>
      <Section n="02" id="fx" title="FX terms">
        <KV>{FX.map(([t, d]) => <KVRow key={t} term={t}>{d}</KVRow>)}</KV>
      </Section>
    </>
  );
}
