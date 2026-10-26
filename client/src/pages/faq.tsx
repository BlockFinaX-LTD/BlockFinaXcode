/**
 * faq.tsx — the questions people actually ask, answered from the contract.
 *
 * Every figure here was read from the deployed Diamond on Base rather than
 * from documentation, because documentation is where fee numbers go to rot.
 * The fee rates are read live at render for the same reason: if the on-chain
 * config changes, this page changes with it instead of quietly becoming wrong.
 *
 * Answers are grouped by who is asking. A hedger and an underwriter have
 * opposite interests in the same contract, and merging their questions into one
 * list makes both of them read half a page that is not for them.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, ChevronDown, HelpCircle } from "lucide-react";
import { hedgeContract, type HedgeFeeConfig } from "@/lib/hedge-contract";

type QA = { q: string; a: React.ReactNode };

function Item({ item, open, onToggle }: { item: QA; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 py-4 text-left"
      >
        <span className="flex-1 text-sm font-medium text-foreground">{item.q}</span>
        <ChevronDown
          className={`mt-0.5 h-4 w-4 flex-none text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="pb-4 pr-7 text-sm leading-relaxed text-muted-foreground space-y-2 [&_a]:text-primary [&_a]:underline [&_strong]:text-foreground [&_strong]:font-medium">
          {item.a}
        </div>
      )}
    </div>
  );
}

function Group({ title, items }: { title: string; items: QA[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <section className="space-y-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="rounded-xl border border-border bg-card px-4">
        {items.map((it, i) => (
          <Item key={it.q} item={it} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? null : i)} />
        ))}
      </div>
    </section>
  );
}

export default function FaqPage() {
  const [, navigate] = useLocation();

  /**
   * Fees, live from the Diamond.
   *
   * Hardcoding them would guarantee this page disagrees with the app the first
   * time the config is changed, and a fee page that is wrong is worse than no
   * fee page. Falls back to the contract client's own defaults if the RPC is
   * unreachable, which is the same figure the app would show in that moment.
   */
  const [fees, setFees] = useState<HedgeFeeConfig | null>(null);
  useEffect(() => {
    let live = true;
    hedgeContract.getFeeConfig()
      .then((f) => { if (live) setFees(f); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const pct = (v: number | undefined) => (typeof v === "number" ? `${(v * 100).toFixed(v * 100 < 1 ? 2 : 0)}%` : "…");
  const usd = (v: number | undefined) => (typeof v === "number" ? `$${v.toFixed(2)}` : "…");

  const general: QA[] = [
    {
      q: "What does BlockFinaX actually do?",
      a: <>
        <p>It lets you buy protection against a currency moving against you, and lets other
          people earn by providing the capital that backs that protection.</p>
        <p>If you import goods and pay in dollars, a weakening cedi raises your costs. You buy
          cover that pays out if the rate passes a level you choose. If it does not pass that
          level, the cover expires and you paid for protection you did not need, the same way
          insurance works.</p>
      </>,
    },
    {
      q: "Which currencies can I cover?",
      a: <>
        <p>Around sixty pairs are priced live, weighted toward African currencies that are hard
          to hedge anywhere else: the cedi, naira, shilling, rand, dirham, CFA franc and others,
          against the dollar, euro and pound. Major commodities and crypto are also quoted.</p>
        <p>Whether a pool exists for a given pair depends on someone having opened one. You can
          see what is live on the <Link href="/hedge">Cover page</Link>.</p>
      </>,
    },
    {
      q: "Where does my money go? Do you hold it?",
      a: <>
        <p><strong>No.</strong> Payments go to a smart contract on Base, not to a BlockFinaX
          account. Premiums sit in the pool, payouts come out of the pool, and the rules that move
          them are in the contract rather than in our hands.</p>
        <p>Everything is denominated in USDC or USDT, so what you deposit does not itself drift in
          value while a pool runs.</p>
      </>,
    },
    {
      q: "Who decides the rate at settlement?",
      a: <>
        <p>Three independent oracle nodes publish rates on chain from separate data sources. A
          contract settles on the rate recorded at its expiry, not on a rate anyone submits
          afterwards, and not on a price BlockFinaX chooses at the time.</p>
        <p>What matters is where the rate <strong>finishes</strong>, not whether it touched your
          level along the way.</p>
      </>,
    },
  ];

  const buyers: QA[] = [
    {
      q: "How much does cover cost?",
      a: <>
        <p>You pay a premium, quoted as a percentage of the amount you are covering. On $50,000 of
          exposure at 1%, the premium is $500.</p>
        <p>On top of that the protocol takes <strong>{pct(fees?.hedgerFeeRate)} of the premium</strong>,
          not of the amount covered. On a $500 premium that is
          {fees ? ` $${(500 * fees.hedgerFeeRate).toFixed(2)}` : " a few dollars"}, not
          {fees ? ` $${(50000 * fees.hedgerFeeRate).toFixed(0)}` : " hundreds"}. The buy screen shows
          both lines before you confirm.</p>
      </>,
    },
    {
      q: "Why did the premium change since I last looked?",
      a: <>
        <p>Some pools are fixed price and never move. Others are priced at the moment you buy, and
          the creator chooses which when they open the pool. It cannot be switched afterwards.</p>
        <p>On a pool that moves, three things push the price: how much time is left, how close the
          rate has come to your payout level, and how much of the pool is already committed. Tap
          the ⓘ beside any premium in the app and it will show you where that pool stands on all
          three, in its own numbers.</p>
      </>,
    },
    {
      q: "What do I get paid if the rate moves?",
      a: <>
        <p>Payout starts at the strike, grows as the rate moves further, and stops at the limit. Past
          the limit the payout holds steady however far the rate goes.</p>
        <p>The limit is not there to short you. It is what lets the people backing the pool know
          their worst case in advance, and without a known worst case nobody would take the other
          side.</p>
        <p>A claim pays out net of {pct(fees?.hedgerPayoutFeeRate)}.</p>
      </>,
    },
    {
      q: "What is the smallest amount I can cover?",
      a: <>
        <p>$10. There is no upper limit beyond what the pool can actually cover, and the app tells
          you the most a given pool can take before you try.</p>
        <p>Cover is not sold in the final hour before a pool expires. By then the outcome is close
          to decided and the premium would be a formality.</p>
      </>,
    },
    {
      q: "My cover expired without paying out. Did I lose money?",
      a: <>
        <p>You spent the premium and the rate stayed the safe side of your strike. That is the
          same as a year of insurance with no claim: the cost bought certainty over the period,
          and the outcome you were protecting against did not happen.</p>
        <p>The app says exactly this rather than showing it as a loss, because a hedge that was
          not needed is not a bad trade.</p>
      </>,
    },
  ];

  const underwriters: QA[] = [
    {
      q: "How do I earn by underwriting?",
      a: <>
        <p>You deposit into a pool. Everyone who buys cover from that pool pays a premium, and you
          receive a share of those premiums proportional to your share of the pool.</p>
        <p>In exchange, if the rate passes the strike, part of your deposit pays the claims. The
          premiums are yours either way.</p>
      </>,
    },
    {
      q: "What is the most I can lose?",
      a: <>
        <p>Known in advance and limited by the contract. Your worst case is your share of the pool's
          maximum payout, which is fixed by the strike and the limit when the pool is created and
          cannot grow however far the rate moves past it.</p>
        <p>Opening a pool costs {usd(fees?.creationFee)}. The protocol takes
          {" "}{pct(fees?.lpProfitFeeRate)} of underwriting profit.</p>
      </>,
    },
    {
      q: "Can I set any premium I like?",
      a: <>
        <p>No, and the limits exist to protect buyers from pools that should never have been
          written. A premium larger than the pool could ever pay is refused outright. So is one
          that leaves too little upside to be worth buying once fees are paid.</p>
        <p>A premium implying a volatility far from what the market shows is also refused, though
          the band is deliberately wide: an underwriter with a genuine view may sit well off market
          and be right.</p>
      </>,
    },
    {
      q: "Can I take my money out early?",
      a: <>
        <p>Principal is withdrawable after the pool settles. Premiums can be claimed from the
          moment a hedger pays them, without waiting for settlement.</p>
        <p>Capital cannot be pulled mid-pool, because the cover people bought would stop being
          backed by anything.</p>
      </>,
    },
  ];

  const groups: Array<[string, QA[]]> = [
    ["The basics", general],
    ["Buying cover", buyers],
    ["Underwriting", underwriters],
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-8 pb-20">
        <div className="mb-8 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            aria-label="Back"
            className="rounded-md p-2 text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold">Frequently asked questions</h1>
          </div>
        </div>

        <p className="mb-8 text-sm leading-relaxed text-muted-foreground">
          If your question is not here, email{" "}
          <a href="mailto:hello@blockfinax.com" className="text-primary underline">hello@blockfinax.com</a>{" "}
          and we will answer it and add it.
        </p>

        <div className="space-y-8">
          {groups.map(([title, items]) => <Group key={title} title={title} items={items} />)}
        </div>

        <p className="mt-10 border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
          Fee figures on this page are read from the deployed contract on Base when the page loads,
          so they cannot drift from what the app charges. Nothing here is financial advice, and
          none of it overrides the{" "}
          <Link href="/terms" className="text-primary underline">Terms of Use</Link>.
        </p>
      </div>
    </div>
  );
}
