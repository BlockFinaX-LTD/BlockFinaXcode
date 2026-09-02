/**
 * Predict — coming-soon page for the upcoming FX prediction market.
 * Routed at /predict (public). Intentionally minimal.
 *
 * The market itself is built and its server side is live: parimutuel pricing,
 * the money ledger, deposits, settlement and the routes under /api/predict are
 * all deployed and tested. Only this page is held back, so the feature can be
 * opened by restoring the market UI rather than rebuilding it.
 *
 * That UI is at commit a970002, client/src/pages/predict.tsx. It is kept in
 * history rather than in an unrouted file, because dead code in the tree rots
 * quietly while a commit does not.
 */
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Clock } from 'lucide-react';

export default function PredictPage() {
  return (
    <div className="min-h-screen bg-white text-[#0a0e1a]">
      {/* nav */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 no-underline">
            <img src="/favicon.png" alt="" className="w-7 h-7 rounded-md" />
            <span className="font-semibold tracking-tight text-[#0a0e1a]">BlockFinaX</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="hidden sm:inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 no-underline px-3 py-2 rounded-full">
              <ArrowLeft className="h-4 w-4" /> Home
            </Link>
            <Link href="/hedge" className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-[#1a4480] hover:bg-[#153a6e] no-underline px-5 py-2.5 rounded-full transition-colors">
              Launch App <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <main className="max-w-2xl mx-auto px-5">
        <section className="pt-24 sm:pt-32 pb-24 text-center">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#1a4480] bg-[#1a4480]/10 px-3 py-1.5 rounded-full">
            <Clock className="h-3.5 w-3.5" /> Coming soon
          </span>
          <h1 className="mt-6 text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            Predict where FX is headed.
          </h1>
          <p className="mt-6 text-[16px] sm:text-[17px] leading-relaxed text-gray-500">
            BlockFinaX Predict is a prediction market for emerging market currencies. Take a view on where a
            rate is going. For example, will USD/NGN trade above ₦1,700 by month end? Buy Yes or No shares,
            and the live price is the market's probability. It settles on the same FX oracle that powers Cover.
          </p>
          <div className="mt-9">
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 border border-gray-200 hover:border-gray-300 no-underline px-6 py-3 rounded-full transition-colors">
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
