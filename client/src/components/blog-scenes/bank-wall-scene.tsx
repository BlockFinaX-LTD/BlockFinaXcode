import { motion } from "framer-motion";
import { User, Building2, X, ArrowRight } from "lucide-react";
import { useInView } from "./use-in-view";

interface Barrier {
  title: string;
  detail: string;
}

interface Props {
  barriers: Barrier[];
}

export function BankWallScene({ barriers }: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);

  return (
    <div ref={ref} className="my-8">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#1a4480] to-[#4a90e2] flex items-center justify-center shadow-md">
              <User className="h-7 w-7 text-white" />
            </div>
            <div className="mt-2 text-xs font-semibold text-gray-700">You</div>
            <div className="text-[10px] text-gray-400">small business</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={inView ? { opacity: 1, scaleX: 1 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex-1 flex items-center justify-center"
          >
            <div className="flex items-center gap-1 text-gray-300">
              <div className="h-[2px] flex-1 bg-gradient-to-r from-gray-200 to-gray-300 min-w-[20px]" />
              <ArrowRight className="h-4 w-4" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex flex-col items-center text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-md">
              <Building2 className="h-7 w-7 text-white" />
            </div>
            <div className="mt-2 text-xs font-semibold text-gray-700">The Bank</div>
            <div className="text-[10px] text-gray-400">FX desk</div>
          </motion.div>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-3 text-center">The bank says</div>

        <div className="space-y-3">
          {barriers.map((b, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -30 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ duration: 0.4, delay: 0.8 + i * 0.5 }}
              className="flex items-start gap-3 p-3 rounded-xl bg-red-50 border border-red-100"
            >
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center mt-0.5">
                <X className="h-3.5 w-3.5 text-white" strokeWidth={3} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-900">{b.title}</div>
                <div className="text-xs text-gray-500 leading-relaxed mt-0.5">{b.detail}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.8 + barriers.length * 0.5 + 0.3 }}
          className="mt-5 p-4 rounded-xl bg-amber-50 border border-amber-200 text-center"
        >
          <div className="text-sm font-semibold text-amber-900">You walk away.</div>
          <div className="text-xs text-amber-700 mt-1">No hedge. Eat the loss when the rate moves.</div>
        </motion.div>
      </div>
    </div>
  );
}
