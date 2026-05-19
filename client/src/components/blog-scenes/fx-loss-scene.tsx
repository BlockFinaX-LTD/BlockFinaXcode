import { motion } from "framer-motion";
import { useInView, useAnimatedNumber } from "./use-in-view";
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

const FONT = "Inter, system-ui, -apple-system, sans-serif";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function FxLossScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const day = useAnimatedNumber(0, p.days, 5, inView);
  const rate = useAnimatedNumber(p.startRate, p.endRate, 5, inView);
  const loss = (p.endRate - p.startRate) * p.invoice;

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-3xl border border-amber-100 aspect-[2/1] sm:aspect-[2.4/1] shadow-sm">
        <svg viewBox="0 0 600 250" className="w-full h-full block" preserveAspectRatio="xMidYMid meet" style={{ fontFamily: FONT }}>
          <defs>
            <linearGradient id="fxSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcd7f5" />
              <stop offset="60%" stopColor="#e6dfca" />
              <stop offset="100%" stopColor="#f3e4c4" />
            </linearGradient>
            <linearGradient id="fxGround" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e9d3a8" />
              <stop offset="100%" stopColor="#d9bb7f" />
            </linearGradient>
            <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe17a" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#ffe17a" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Sky */}
          <rect width="600" height="180" fill="url(#fxSky)" />
          {/* Sky darkens as storm rolls in */}
          <motion.rect
            width="600"
            height="180"
            fill="#1e293b"
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: [0, 0, 0.25] } : {}}
            transition={{ duration: 5, times: [0, 0.4, 0.7] }}
          />
          {/* Ground */}
          <rect y="180" width="600" height="70" fill="url(#fxGround)" />
          <rect y="180" width="600" height="2" fill="#b89559" opacity="0.5" />

          {/* Sun — top right, fades as storm comes */}
          <motion.g
            initial={{ opacity: 1 }}
            animate={inView ? { opacity: [1, 1, 0.15] } : {}}
            transition={{ duration: 5, times: [0, 0.3, 0.55] }}
          >
            <circle cx="520" cy="55" r="48" fill="url(#sunGlow)" />
            <circle cx="520" cy="55" r="20" fill="#ffd24c" />
          </motion.g>

          {/* Storm cloud rolls in — slight overshoot for natural settling */}
          <motion.g
            initial={{ x: 700 }}
            animate={inView ? { x: 0 } : {}}
            transition={{ delay: 1.3, type: "spring", stiffness: 38, damping: 13, mass: 1.2 }}
          >
            <g transform="translate(380, 55)">
              <ellipse cx="0" cy="0" rx="60" ry="22" fill="#475569" />
              <ellipse cx="-32" cy="-8" rx="28" ry="20" fill="#64748b" />
              <ellipse cx="28" cy="-10" rx="34" ry="22" fill="#64748b" />
              <ellipse cx="-8" cy="-18" rx="26" ry="18" fill="#7e8b9c" />
              <ellipse cx="0" cy="4" rx="60" ry="6" fill="#334155" opacity="0.5" />
              {/* Rain */}
              <motion.g
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: [0, 0, 1] } : {}}
                transition={{ duration: 5, times: [0, 0.45, 0.55] }}
              >
                {[-32, -18, -4, 12, 26].map((x, i) => (
                  <motion.line
                    key={i}
                    x1={x}
                    y1={10}
                    x2={x - 3}
                    y2={32}
                    stroke="#7aaad8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    animate={{ opacity: [0.9, 0.3, 0.9] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12 }}
                  />
                ))}
              </motion.g>
            </g>
          </motion.g>

          {/* Day counter — top right, animated */}
          <g transform="translate(540, 30)">
            <rect x="-44" y="-14" width="88" height="28" rx="14" fill="#1a4480" />
            <text
              x="0"
              y="5"
              textAnchor="middle"
              fontSize="11"
              fontWeight="800"
              fill="#fff"
              letterSpacing="0.8"
              style={{ fontFamily: FONT }}
            >
              DAY {Math.round(day)}
            </text>
          </g>

          {/* Rate panel — top left */}
          <g transform="translate(100, 60)">
            <motion.g
              initial={{ opacity: 0, y: -8 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <rect x="-60" y="-26" width="120" height="52" rx="10" fill="#ffffff" stroke="#1a4480" strokeWidth="1.8" />
              <text
                x="-50"
                y="-10"
                fontSize="8.5"
                fontWeight="700"
                fill="#6b7280"
                letterSpacing="0.6"
                style={{ fontFamily: FONT }}
              >
                {p.fromCurrency}/{p.toCurrency}
              </text>
              <text
                x="0"
                y="18"
                textAnchor="middle"
                fontSize="22"
                fontWeight="800"
                fill="#dc2626"
                letterSpacing="-0.5"
                style={{ fontFamily: MONO }}
              >
                {rate.toFixed(2)}
              </text>
              {/* Trend arrow on the right */}
              <motion.g
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: 1, y: [0, 3, 0, 3, 0] } : {}}
                transition={{ opacity: { delay: 1 }, y: { duration: 1.5, repeat: Infinity } }}
              >
                <path d="M 46 -4 L 46 14 M 40 8 L 46 14 L 52 8" stroke="#dc2626" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </motion.g>
            </motion.g>
          </g>

          {/* Character (left of center, in the ground area) */}
          <g transform="translate(220, 175)">
            <CharacterTimeline inView={inView} />
          </g>

          {/* Money bag in front of character — shrinks */}
          <g transform="translate(280, 175)">
            <motion.g
              initial={{ scale: 1 }}
              animate={inView ? { scale: [1, 1, 1, 0.55] } : { scale: 1 }}
              transition={{ duration: 5, times: [0, 0.45, 0.55, 1], ease: "easeInOut" }}
              style={{ transformOrigin: "0 14px" }}
            >
              <MoneyBag />
              <text
                x="0"
                y="36"
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="#3a2410"
                letterSpacing="0.3"
                style={{ fontFamily: MONO }}
              >
                {p.fromSymbol}{fmt(p.invoice)}
              </text>
            </motion.g>
          </g>

          {/* Loss badge — bottom right (static-positioned wrapper avoids framer overriding our translate) */}
          <g transform="translate(460, 215)">
            <motion.g
              initial={{ opacity: 0, scale: 0.5, y: 30 }}
              animate={inView ? { opacity: [0, 0, 0, 1], scale: [0.5, 0.5, 0.5, 1], y: [30, 30, 30, 0] } : {}}
              transition={{ duration: 5, times: [0, 0.65, 0.75, 0.92], ease: [0.2, 0.8, 0.4, 1] }}
            >
              <rect x="-90" y="-18" width="180" height="36" rx="18" fill="#dc2626" />
              <rect x="-90" y="-18" width="180" height="18" rx="18" fill="#ef4444" opacity="0.5" />
              <text
                x="0"
                y="5"
                textAnchor="middle"
                fontSize="11.5"
                fontWeight="800"
                fill="#ffffff"
                letterSpacing="0.6"
                style={{ fontFamily: FONT }}
              >
                LOST {p.toSymbol}{fmt(loss)} TO FX
              </text>
            </motion.g>
          </g>
        </svg>
      </div>

      <p className="text-center text-xs text-gray-400 mt-3 italic">
        Same invoice. Currency moved. Your profit didn't survive.
      </p>
    </div>
  );
}

function CharacterTimeline({ inView }: { inView: boolean }) {
  return (
    <>
      <motion.g
        initial={{ opacity: 1 }}
        animate={inView ? { opacity: [1, 1, 0] } : {}}
        transition={{ duration: 5, times: [0, 0.4, 0.45] }}
      >
        <Character mood="happy" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1, 1, 0] } : {}}
        transition={{ duration: 5, times: [0, 0.45, 0.5, 0.7, 0.75] }}
      >
        <Character mood="shocked" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1] } : {}}
        transition={{ duration: 5, times: [0, 0.7, 0.78] }}
      >
        <Character mood="sad" />
      </motion.g>
    </>
  );
}
