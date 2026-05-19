import { motion } from "framer-motion";
import { Shield, ArrowRight, Check, Clock, TrendingDown, TrendingUp, DollarSign } from "lucide-react";
import { useInView } from "./use-in-view";

interface Props {
  premium: number;
  protected: number;
  days: number;
  payout: number;
  currencySymbol: string;
}

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export function InsuranceFlowScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);

  return (
    <div ref={ref} className="my-8 space-y-4">
      {/* Top row: 3-step flow */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="relative rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
        >
          <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-[#1a4480] text-white text-xs font-bold flex items-center justify-center shadow">1</div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-[#1a4480]" />
            </div>
            <div className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Pay premium</div>
          </div>
          <div className="font-mono text-2xl font-bold text-[#1a4480]">{p.currencySymbol}{fmt(p.premium)}</div>
          <div className="text-[11px] text-gray-500 mt-1">one-time, no collateral</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="relative rounded-2xl border border-[#1a4480]/20 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm"
        >
          <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-[#1a4480] text-white text-xs font-bold flex items-center justify-center shadow">2</div>
          <div className="flex items-center gap-2 mb-2">
            <motion.div
              animate={inView ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 2, repeat: Infinity, delay: 0.6 }}
              className="w-9 h-9 rounded-xl bg-[#1a4480]/10 flex items-center justify-center"
            >
              <Shield className="h-5 w-5 text-[#1a4480]" />
            </motion.div>
            <div className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Covered</div>
          </div>
          <div className="font-mono text-2xl font-bold text-[#1a4480]">{p.currencySymbol}{fmt(p.protected)}</div>
          <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
            <Clock className="h-3 w-3" /> {p.days} days
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="relative rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
        >
          <div className="absolute -top-2 -left-2 w-7 h-7 rounded-full bg-[#1a4480] text-white text-xs font-bold flex items-center justify-center shadow">3</div>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center">
              <Check className="h-5 w-5 text-green-600" strokeWidth={3} />
            </div>
            <div className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Outcome</div>
          </div>
          <div className="text-sm text-gray-700">Either way, you're protected</div>
          <div className="text-[11px] text-gray-500 mt-1">no surprises</div>
        </motion.div>
      </div>

      {/* Arrows connecting (desktop only) */}
      <div className="hidden sm:flex justify-around -my-2">
        <motion.div initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.4 }} className="text-gray-300">
          <ArrowRight className="h-4 w-4" />
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.7 }} className="text-gray-300">
          <ArrowRight className="h-4 w-4" />
        </motion.div>
      </div>

      {/* Outcomes split */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.5, delay: 1.0 }}
          className="rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-white p-5"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <TrendingDown className="h-4 w-4 text-green-700" />
            </div>
            <div className="text-xs font-semibold text-green-900 uppercase tracking-wider">Rate moved against you</div>
          </div>
          <div className="font-mono text-2xl font-bold text-green-700">+{p.currencySymbol}{fmt(p.payout)}</div>
          <div className="text-xs text-green-700/80 mt-1">paid out automatically</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={inView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 0.5, delay: 1.2 }}
          className="rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-5"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-gray-600" />
            </div>
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Rate stayed flat</div>
          </div>
          <div className="font-mono text-2xl font-bold text-gray-700">{p.currencySymbol}0</div>
          <div className="text-xs text-gray-500 mt-1">premium used, like insurance</div>
        </motion.div>
      </div>
    </div>
  );
}
