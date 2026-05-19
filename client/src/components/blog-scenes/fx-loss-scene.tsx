import { motion, AnimatePresence } from "framer-motion";
import { useInView } from "./use-in-view";
import { Character, MoneyBag } from "./character";

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

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function FxLossScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#e8f0fa] via-[#f6e6d0] to-[#fde2c4] border border-amber-100 aspect-[2/1] sm:aspect-[2.4/1]">
        {/* Sun */}
        <motion.circle
          initial={{ opacity: 1 }}
          animate={inView ? { opacity: [1, 1, 0.2, 0.2] } : {}}
          transition={{ duration: 6, times: [0, 0.25, 0.45, 1] }}
        />

        <svg viewBox="0 0 600 250" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcd7f5" />
              <stop offset="100%" stopColor="#f6e6d0" />
            </linearGradient>
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe17a" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ffe17a" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Sky */}
          <rect width="600" height="180" fill="url(#sky)" />
          {/* Ground */}
          <rect y="180" width="600" height="70" fill="#e9d3a8" />
          <rect y="180" width="600" height="3" fill="#d9bb7f" />

          {/* Sun → fades */}
          <motion.g
            initial={{ opacity: 1 }}
            animate={inView ? { opacity: [1, 1, 0.15, 0.15] } : { opacity: 1 }}
            transition={{ duration: 6, times: [0, 0.25, 0.45, 1] }}
          >
            <circle cx="500" cy="55" r="50" fill="url(#sunGlow)" />
            <circle cx="500" cy="55" r="22" fill="#ffd24c" />
          </motion.g>

          {/* Storm cloud — rolls in */}
          <motion.g
            initial={{ x: 700, opacity: 0 }}
            animate={inView ? { x: 0, opacity: 1 } : {}}
            transition={{ duration: 2, delay: 1.5, ease: "easeOut" }}
          >
            <g transform="translate(380, 50)">
              <ellipse cx="0" cy="0" rx="55" ry="22" fill="#4a5568" />
              <ellipse cx="-30" cy="-10" rx="28" ry="20" fill="#5a6473" />
              <ellipse cx="25" cy="-12" rx="32" ry="22" fill="#5a6473" />
              <ellipse cx="-10" cy="-18" rx="25" ry="18" fill="#6b7785" />
              <ellipse cx="0" cy="3" rx="55" ry="6" fill="#374151" opacity="0.5" />
              {/* Rain */}
              <motion.g
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: [0, 0, 1, 1] } : {}}
                transition={{ duration: 6, times: [0, 0.4, 0.5, 1] }}
              >
                {[-30, -15, 0, 15, 30].map((x, i) => (
                  <motion.line
                    key={i}
                    x1={x}
                    y1={10}
                    x2={x - 3}
                    y2={28}
                    stroke="#5a8fc7"
                    strokeWidth="2"
                    strokeLinecap="round"
                    animate={{ opacity: [1, 0.2, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12 }}
                  />
                ))}
              </motion.g>
            </g>
          </motion.g>

          {/* Lightning flash */}
          <motion.g
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: [0, 0, 0, 1, 0, 1, 0] } : {}}
            transition={{ duration: 6, times: [0, 0.4, 0.48, 0.5, 0.55, 0.58, 0.65] }}
          >
            <path d="M 380 75 L 372 100 L 380 100 L 372 130 L 392 95 L 384 95 L 392 75 Z" fill="#fde047" stroke="#facc15" strokeWidth="1.5" />
          </motion.g>

          {/* Rate sign — counter */}
          <g transform="translate(120, 70)">
            <motion.g
              initial={{ scale: 0, y: -10 }}
              animate={inView ? { scale: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <rect x="-55" y="-22" width="110" height="44" rx="8" fill="#fff" stroke="#1a4480" strokeWidth="2" />
              <text x="0" y="-7" textAnchor="middle" fontSize="9" fontWeight="700" fill="#6b7280">
                {p.fromCurrency}/{p.toCurrency}
              </text>
              <RateText startRate={p.startRate} endRate={p.endRate} inView={inView} />
            </motion.g>
            {/* Arrow */}
            <motion.g
              initial={{ opacity: 0, y: 0 }}
              animate={inView ? { opacity: 1, y: [0, 5, 0, 5, 0] } : {}}
              transition={{ delay: 1.8, duration: 2, repeat: Infinity }}
            >
              <path d="M 0 35 L 0 60 M -8 52 L 0 60 L 8 52" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" fill="none" />
            </motion.g>
          </g>

          {/* Character on left */}
          <g transform="translate(155, 175)">
            <CharacterMoodSwitcher inView={inView} />
          </g>

          {/* Money bag in character's hand — shrinks */}
          <g transform="translate(195, 175)">
            <motion.g
              initial={{ scale: 1 }}
              animate={inView ? { scale: [1, 1, 1, 0.55] } : {}}
              transition={{ duration: 6, times: [0, 0.45, 0.55, 1], ease: "easeInOut" }}
            >
              <MoneyBag label={`${p.fromSymbol}${fmt(p.invoice)}`} />
            </motion.g>
          </g>

          {/* Loss label appears at end */}
          <AnimatePresence>
            {inView && (
              <motion.g
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 4.2, duration: 0.6, type: "spring" }}
              >
                <rect x="300" y="195" width="200" height="40" rx="20" fill="#dc2626" />
                <rect x="300" y="195" width="200" height="40" rx="20" fill="url(#lossShine)" opacity="0.4" />
                <text x="400" y="221" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" letterSpacing="0.3">
                  LOST {p.toSymbol}{fmt((p.endRate - p.startRate) * p.invoice)} TO FX
                </text>
                <defs>
                  <linearGradient id="lossShine" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fff" />
                    <stop offset="100%" stopColor="#dc2626" />
                  </linearGradient>
                </defs>
              </motion.g>
            )}
          </AnimatePresence>

          {/* Day counter */}
          <g transform="translate(540, 30)">
            <motion.g
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ delay: 0.4 }}
            >
              <rect x="-40" y="-15" width="80" height="30" rx="15" fill="#1a4480" />
              <DayText days={p.days} inView={inView} />
            </motion.g>
          </g>

          {/* Tree on far right for atmosphere */}
          <g transform="translate(560, 195)">
            <rect x="-3" y="-5" width="6" height="20" fill="#7a5230" />
            <circle cx="0" cy="-15" r="18" fill="#5a8a3f" />
            <circle cx="-10" cy="-10" r="12" fill="#6c9b4d" />
            <circle cx="10" cy="-12" r="13" fill="#6c9b4d" />
          </g>
        </svg>
      </div>

      <p className="text-center text-xs text-gray-400 mt-2">
        Same deal. Same invoice. The currency moved — and your profit didn't survive.
      </p>
    </div>
  );
}

function RateText({ startRate, endRate, inView }: { startRate: number; endRate: number; inView: boolean }) {
  return (
    <motion.text
      x="0"
      y="14"
      textAnchor="middle"
      fontSize="20"
      fontWeight="800"
      fill="#dc2626"
      style={{ fontFamily: "ui-monospace, monospace" }}
    >
      <motion.tspan
        initial={{ opacity: 1 }}
        animate={inView ? { opacity: [1, 1, 0] } : {}}
        transition={{ duration: 6, times: [0, 0.4, 0.5] }}
      >
        {startRate.toFixed(2)}
      </motion.tspan>
      <motion.tspan
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1] } : {}}
        transition={{ duration: 6, times: [0, 0.5, 0.6] }}
      >
        {" "}{endRate.toFixed(2)}
      </motion.tspan>
    </motion.text>
  );
}

function DayText({ days, inView }: { days: number; inView: boolean }) {
  return (
    <text x="0" y="5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" letterSpacing="0.5">
      <DayCounter days={days} inView={inView} />
    </text>
  );
}

function DayCounter({ days, inView }: { days: number; inView: boolean }) {
  // We can't animate text content via framer-motion directly inside SVG <text>,
  // so we render a few keyframes via tspans with cross-fades.
  const keyframes = [0, Math.floor(days * 0.3), Math.floor(days * 0.6), days];
  return (
    <>
      {keyframes.map((k, i) => (
        <motion.tspan
          key={i}
          x="0"
          dy={i === 0 ? 0 : -11}
          initial={{ opacity: i === 0 ? 1 : 0 }}
          animate={
            inView
              ? {
                  opacity:
                    i === 0
                      ? [1, 1, 0]
                      : i === keyframes.length - 1
                        ? [0, 0, 1, 1]
                        : [0, 0, 1, 1, 0],
                }
              : {}
          }
          transition={{
            duration: 6,
            times:
              i === 0
                ? [0, 0.2, 0.3]
                : i === keyframes.length - 1
                  ? [0, 0.7, 0.8, 1]
                  : [0, (i - 0.5) / keyframes.length, i / keyframes.length, (i + 0.3) / keyframes.length, (i + 0.6) / keyframes.length],
          }}
        >
          DAY {k}
        </motion.tspan>
      ))}
    </>
  );
}

function CharacterMoodSwitcher({ inView }: { inView: boolean }) {
  return (
    <>
      <motion.g
        initial={{ opacity: 1 }}
        animate={inView ? { opacity: [1, 1, 0, 0] } : {}}
        transition={{ duration: 6, times: [0, 0.4, 0.5, 1] }}
      >
        <Character mood="happy" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1, 1, 0] } : {}}
        transition={{ duration: 6, times: [0, 0.5, 0.55, 0.75, 0.85] }}
      >
        <Character mood="shocked" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1] } : {}}
        transition={{ duration: 6, times: [0, 0.8, 0.9] }}
      >
        <Character mood="sad" />
      </motion.g>
    </>
  );
}
