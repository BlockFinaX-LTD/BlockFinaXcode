import { motion } from "framer-motion";
import { useInView, useAnimatedNumber } from "./use-in-view";
import { Character } from "./character";
import { Banknote, CashStack, FloatingNumber } from "./objects";

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

const FONT = "Inter, system-ui, -apple-system, sans-serif";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function FxLossScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const rate = useAnimatedNumber(p.startRate, p.endRate, 4.5, inView, 0.5);
  const loss = (p.endRate - p.startRate) * p.invoice;

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-3xl border border-amber-100 aspect-[2/1] sm:aspect-[2.4/1] shadow-sm">
        <svg viewBox="0 0 600 250" className="w-full h-full block" preserveAspectRatio="xMidYMid meet" style={{ fontFamily: FONT }}>
          <defs>
            <linearGradient id="fxSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcd7f5" />
              <stop offset="65%" stopColor="#e6dfca" />
              <stop offset="100%" stopColor="#f3e4c4" />
            </linearGradient>
            <linearGradient id="fxGround" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e9d3a8" />
              <stop offset="100%" stopColor="#d9bb7f" />
            </linearGradient>
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe17a" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#ffe17a" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Sky */}
          <rect width="600" height="180" fill="url(#fxSky)" />
          {/* Ground */}
          <rect y="180" width="600" height="70" fill="url(#fxGround)" />
          <rect y="180" width="600" height="2" fill="#b89559" opacity="0.5" />

          {/* Sun stays warm — it's not a storm anymore */}
          <g>
            <circle cx="520" cy="55" r="48" fill="url(#sunGlow)" />
            <circle cx="520" cy="55" r="22" fill="#ffd24c" />
            <circle cx="520" cy="55" r="14" fill="#ffe082" />
          </g>

          {/* Exchange rate billboard on a wooden post (middle-back) */}
          <g transform="translate(360, 80)">
            {/* Posts */}
            <rect x="-44" y="20" width="5" height="80" fill="#7c5028" />
            <rect x="39" y="20" width="5" height="80" fill="#7c5028" />
            {/* Sign body */}
            <rect x="-58" y="-30" width="116" height="56" rx="3" fill="#2d2a26" />
            <rect x="-55" y="-27" width="110" height="50" rx="2" fill="#1f1d1b" />
            {/* Header */}
            <text
              x="0"
              y="-14"
              textAnchor="middle"
              fontSize="9"
              fontWeight="700"
              fill="#94a3b8"
              letterSpacing="1.2"
              style={{ fontFamily: FONT }}
            >
              {p.fromCurrency} / {p.toCurrency}
            </text>
            {/* Animated rate */}
            <text
              x="0"
              y="14"
              textAnchor="middle"
              fontSize="26"
              fontWeight="800"
              fill="#f87171"
              letterSpacing="-0.5"
              style={{ fontFamily: MONO }}
            >
              {rate.toFixed(2)}
            </text>
            {/* Small upward arrow next to value indicating the rate is climbing against you */}
            <motion.g
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <path
                d="M 38 12 L 42 4 L 46 12 Z"
                fill="#f87171"
                stroke="#f87171"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </motion.g>
          </g>

          {/* Character holding cash stack */}
          <g transform="translate(150, 175)">
            <CharacterTimeline inView={inView} />
          </g>

          {/* Cash stack in character's hand — bills detach as rate moves */}
          <g transform="translate(190, 168)">
            {/* Stack of 4 bills, stays in place */}
            <CashStack amount={`${p.fromSymbol}${fmt(p.invoice / 1000)}K`} count={4} scale={0.85} />
          </g>

          {/* Four bills flying away from the stack at staggered times */}
          {[0, 1, 2, 3].map(i => (
            <FlyAwayBill
              key={i}
              startX={190 + i * 2}
              startY={168 - i * 2}
              amount={`${p.fromSymbol}${fmt(p.invoice / 1000)}K`}
              delay={1.6 + i * 0.45}
              inView={inView}
            />
          ))}

          {/* Floating damage number — rises and fades */}
          <g transform="translate(190, 155)">
            <FloatingNumber
              text={`−${p.toSymbol}${fmt(loss)}`}
              color="#dc2626"
              fontSize={22}
              startDelay={3.5}
              startY={0}
              endY={-70}
              duration={2.2}
              trigger={inView}
            />
          </g>

          {/* Subtle "days passing" callout in the corner */}
          <g transform="translate(64, 36)">
            <motion.g
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              {/* Calendar icon */}
              <rect x="-12" y="-10" width="24" height="22" rx="2" fill="#fff" stroke="#1f2937" strokeWidth="1.4" />
              <rect x="-12" y="-10" width="24" height="6" fill="#1a4480" />
              <line x1="-7" y1="-12" x2="-7" y2="-7" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
              <line x1="7" y1="-12" x2="7" y2="-7" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
              <text
                x="0"
                y="7"
                textAnchor="middle"
                fontSize="7.5"
                fontWeight="800"
                fill="#1f2937"
                style={{ fontFamily: FONT }}
              >
                60d
              </text>
              <text
                x="20"
                y="3"
                fontSize="8"
                fontWeight="600"
                fill="#475569"
                style={{ fontFamily: FONT }}
              >
                later…
              </text>
            </motion.g>
          </g>
        </svg>
      </div>

      <p className="text-center text-xs text-gray-400 mt-3 italic">
        Same invoice. The rate climbed. Your profit walked away with the bills.
      </p>
    </div>
  );
}

function FlyAwayBill({
  startX,
  startY,
  amount,
  delay,
  inView,
}: {
  startX: number;
  startY: number;
  amount: string;
  delay: number;
  inView: boolean;
}) {
  return (
    <motion.g
      initial={{ x: startX, y: startY, opacity: 0, rotate: 0 }}
      animate={
        inView
          ? {
              x: [startX, startX + 80, startX + 200],
              y: [startY, startY - 30, startY - 90],
              opacity: [0, 1, 0],
              rotate: [0, 20, 45],
            }
          : {}
      }
      transition={{ delay, duration: 1.6, times: [0, 0.4, 1], ease: "easeOut" }}
    >
      <Banknote amount={amount} scale={0.75} />
    </motion.g>
  );
}

function CharacterTimeline({ inView }: { inView: boolean }) {
  return (
    <>
      <motion.g
        initial={{ opacity: 1 }}
        animate={inView ? { opacity: [1, 1, 0] } : {}}
        transition={{ duration: 5, times: [0, 0.35, 0.4] }}
      >
        <Character mood="happy" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1, 1, 0] } : {}}
        transition={{ duration: 5, times: [0, 0.4, 0.45, 0.65, 0.7] }}
      >
        <Character mood="shocked" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1] } : {}}
        transition={{ duration: 5, times: [0, 0.65, 0.72] }}
      >
        <Character mood="sad" />
      </motion.g>
    </>
  );
}
