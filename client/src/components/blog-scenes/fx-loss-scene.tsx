import { motion } from "framer-motion";
import { Calendar, TrendingDown, AlertCircle } from "lucide-react";
import { useInView, useAnimatedNumber } from "./use-in-view";

interface Props {
  invoice: number;
  fromCurrency: string;
  toCurrency: string;
  fromSymbol: string;
  toSymbol: string;
  startRate: number;
  endRate: number;
  days: number;
  marginStart: number;
  marginEnd: number;
}

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function FxLossScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.35);

  const day = useAnimatedNumber(0, p.days, 4, inView);
  const rate = useAnimatedNumber(p.startRate, p.endRate, 4, inView);
  const costStart = p.invoice * p.startRate;
  const costEnd = p.invoice * p.endRate;
  const cost = useAnimatedNumber(costStart, costEnd, 4, inView);
  const margin = useAnimatedNumber(p.marginStart, p.marginEnd, 4, inView);
  const loss = useAnimatedNumber(0, costEnd - costStart, 4, inView, 0.5);

  const marginPct = ((margin - 0) / Math.max(p.marginStart, 1)) * 100;

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0f2744] via-[#1a4480] to-[#0f2744] p-6 sm:p-8 text-white shadow-xl">
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[#4a90e2]/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-red-500/10 blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between mb-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-blue-200">
            <Calendar className="h-3.5 w-3.5" />
            <span>Day {Math.round(day)} of {p.days}</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-blue-300/80">live invoice tracker</div>
        </div>

        <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-blue-200/80 mb-1">Invoice</div>
            <div className="font-mono text-xl sm:text-2xl font-bold">{p.fromSymbol}{fmt(p.invoice)}</div>
            <div className="text-[11px] text-blue-300/70 mt-0.5">{p.fromCurrency}</div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10 relative overflow-hidden">
            <div className="text-[10px] uppercase tracking-wider text-blue-200/80 mb-1 flex items-center gap-1.5">
              Exchange rate <TrendingDown className="h-3 w-3 text-red-300" />
            </div>
            <div className="font-mono text-xl sm:text-2xl font-bold tabular-nums">{rate.toFixed(2)}</div>
            <div className="text-[11px] text-blue-300/70 mt-0.5">{p.fromCurrency}/{p.toCurrency}</div>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-blue-200/80 mb-1">Cost in {p.toCurrency}</div>
            <div className="font-mono text-xl sm:text-2xl font-bold tabular-nums">{p.toSymbol}{fmt(cost)}</div>
            <div className="text-[11px] text-blue-300/70 mt-0.5">today's price</div>
          </div>
        </div>

        <div className="relative mb-6">
          <div className="flex items-center justify-between text-xs text-blue-200/90 mb-2">
            <span className="uppercase tracking-wider">Your profit margin</span>
            <span className="font-mono tabular-nums font-semibold">{margin.toFixed(1)}%</span>
          </div>
          <div className="h-3 bg-white/10 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-amber-400 via-orange-400 to-red-400 transition-all duration-150"
              style={{ width: `${Math.max(0, Math.min(100, marginPct))}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-blue-300/60 mt-1">
            <span>start: {p.marginStart}%</span>
            <span>now: {margin.toFixed(1)}%</span>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 2.5, duration: 0.4 }}
          className="relative flex items-center justify-between p-4 rounded-xl bg-red-500/20 border border-red-400/40"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-300" />
            <span className="text-xs uppercase tracking-wider text-red-200">Lost to FX</span>
          </div>
          <div className="font-mono text-xl sm:text-2xl font-bold text-red-100 tabular-nums">
            {p.toSymbol}{fmt(loss)}
          </div>
        </motion.div>
      </div>

      <div className="text-center text-xs text-gray-400 mt-2">
        Same deal. Same invoice. The currency moved — your profit didn't survive.
      </div>
    </div>
  );
}
