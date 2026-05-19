import { motion } from "framer-motion";
import { useInView } from "./use-in-view";
import { Character } from "./character";

interface Props {
  premium: number;
  protected: number;
  days: number;
  payout: number;
  currencySymbol: string;
}

const FONT = "Inter, system-ui, -apple-system, sans-serif";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export function InsuranceFlowScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const DURATION = 7;

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-3xl border border-blue-100 aspect-[2/1] sm:aspect-[2.4/1] shadow-sm">
        <svg viewBox="0 0 600 250" className="w-full h-full block" preserveAspectRatio="xMidYMid meet" style={{ fontFamily: FONT }}>
          <defs>
            <linearGradient id="insSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcd7f5" />
              <stop offset="100%" stopColor="#eef3fb" />
            </linearGradient>
            <linearGradient id="insGround" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d6dce4" />
              <stop offset="100%" stopColor="#aab4c0" />
            </linearGradient>
            <radialGradient id="shieldGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4a90e2" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#4a90e2" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="600" height="195" fill="url(#insSky)" />
          <rect y="195" width="600" height="55" fill="url(#insGround)" />
          <rect y="195" width="600" height="2" fill="#94a0ae" opacity="0.6" />

          {/* Premium label — top left */}
          <g transform="translate(80, 40)">
            <motion.g
              initial={{ opacity: 0, y: -10 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              <rect x="-60" y="-15" width="120" height="30" rx="6" fill="#ffffff" stroke="#1a4480" strokeWidth="1.6" />
              <text
                x="-50"
                y="6"
                fontSize="9"
                fontWeight="700"
                fill="#6b7280"
                letterSpacing="1"
                style={{ fontFamily: FONT }}
              >
                PREMIUM
              </text>
              <text
                x="52"
                y="6"
                textAnchor="end"
                fontSize="13"
                fontWeight="800"
                fill="#1a4480"
                style={{ fontFamily: MONO }}
              >
                {p.currencySymbol}{fmt(p.premium)}
              </text>
            </motion.g>
          </g>

          {/* Days pill — top right */}
          <g transform="translate(540, 40)">
            <motion.g
              initial={{ opacity: 0, y: -10 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              <rect x="-44" y="-15" width="88" height="30" rx="15" fill="#1a4480" />
              <text
                x="0"
                y="6"
                textAnchor="middle"
                fontSize="11"
                fontWeight="800"
                fill="#fff"
                letterSpacing="0.8"
                style={{ fontFamily: FONT }}
              >
                {p.days} DAYS
              </text>
            </motion.g>
          </g>

          {/* Coin flies from top-left to piggy bank */}
          <motion.g
            initial={{ x: 80, y: 70, opacity: 0 }}
            animate={inView ? { x: [80, 80, 130], y: [70, 70, 170], opacity: [0, 1, 1, 0] } : {}}
            transition={{ duration: DURATION, times: [0, 0.1, 0.22, 0.28] }}
          >
            <g>
              <circle r="14" fill="#fcd34d" stroke="#a16207" strokeWidth="1.5" />
              <circle r="11" fill="none" stroke="#a16207" strokeWidth="0.8" />
              <text
                x="0"
                y="4.5"
                textAnchor="middle"
                fontSize="14"
                fontWeight="800"
                fill="#7c2d12"
                style={{ fontFamily: FONT }}
              >
                $
              </text>
            </g>
          </motion.g>

          {/* Piggy bank */}
          <g transform="translate(130, 195)">
            <ellipse cx="0" cy="2" rx="40" ry="6" fill="#000" opacity="0.15" />
            <ellipse cx="0" cy="-14" rx="38" ry="28" fill="#f7a8c4" stroke="#9d3e62" strokeWidth="1.5" />
            <ellipse cx="-24" cy="-14" rx="6" ry="9" fill="#9d3e62" />
            {/* Coin slot — wiggles when coin lands */}
            <motion.rect
              x="-3"
              y="-36"
              width="6"
              height="3"
              rx="0.5"
              fill="#3a2410"
              animate={inView ? { scaleY: [1, 1, 0.4, 1] } : {}}
              transition={{ duration: DURATION, times: [0, 0.22, 0.26, 0.32] }}
              style={{ transformOrigin: "0 -34px" }}
            />
            <circle cx="-11" cy="-17" r="1.8" fill="#3a2410" />
            <ellipse cx="22" cy="-9" rx="4" ry="3" fill="#9d3e62" />
            <circle cx="20.5" cy="-10" r="0.8" fill="#1f2937" />
            <circle cx="23.5" cy="-10" r="0.8" fill="#1f2937" />
            {/* Tail curl */}
            <path d="M 34 -16 Q 42 -19 42 -10 Q 42 -4 38 -6" stroke="#9d3e62" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            {/* Legs */}
            <rect x="-26" y="10" width="6" height="6" rx="1" fill="#9d3e62" />
            <rect x="20" y="10" width="6" height="6" rx="1" fill="#9d3e62" />
          </g>

          {/* Character in middle */}
          <g transform="translate(310, 175)">
            <CharacterMoodSwap inView={inView} duration={DURATION} />
          </g>

          {/* Shield appearing around character (static positioning, animated scale) */}
          <g transform="translate(310, 145)">
            <motion.g
              initial={{ opacity: 0, scale: 0.4 }}
              animate={inView ? { opacity: [0, 0, 1, 1, 1, 1], scale: [0.4, 0.4, 1, 1, 1, 1] } : {}}
              transition={{ duration: DURATION, times: [0, 0.32, 0.42, 0.6, 0.85, 1], ease: [0.2, 0.8, 0.4, 1] }}
            >
              <motion.g
                animate={{ scale: [1, 1.04, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <circle r="62" fill="url(#shieldGlow)" />
                <path
                  d="M 0 -44 L 38 -29 L 38 6 Q 38 33 0 50 Q -38 33 -38 6 L -38 -29 Z"
                  fill="#4a90e2"
                  fillOpacity="0.2"
                  stroke="#1a4480"
                  strokeWidth="2.2"
                />
                <path
                  d="M 0 -39 L 33 -25 L 33 5 Q 33 28 0 42 Q -33 28 -33 5 L -33 -25 Z"
                  fill="none"
                  stroke="#4a90e2"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.7"
                />
                <path
                  d="M -11 0 L -2 10 L 15 -10"
                  stroke="#1a4480"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </motion.g>
            </motion.g>
          </g>

          {/* Storm rolls over with a natural settling overshoot */}
          <motion.g
            initial={{ x: 700 }}
            animate={inView ? { x: 0 } : {}}
            transition={{ delay: 3.8, type: "spring", stiffness: 40, damping: 13, mass: 1.2 }}
          >
            <g transform="translate(310, 52)">
              <ellipse cx="0" cy="0" rx="55" ry="20" fill="#475569" />
              <ellipse cx="-30" cy="-8" rx="26" ry="18" fill="#64748b" />
              <ellipse cx="26" cy="-10" rx="30" ry="20" fill="#64748b" />
              <ellipse cx="-8" cy="-16" rx="24" ry="16" fill="#7e8b9c" />
              <motion.g
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: [0, 0, 0, 1] } : {}}
                transition={{ duration: DURATION, times: [0, 0.55, 0.6, 0.65] }}
              >
                {[-25, -10, 5, 20].map((x, i) => (
                  <motion.line
                    key={i}
                    x1={x}
                    y1={8}
                    x2={x - 2}
                    y2={22}
                    stroke="#7aaad8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }}
                  />
                ))}
              </motion.g>
            </g>
          </motion.g>

          {/* Deflection sparks at shield top */}
          <g transform="translate(310, 105)">
            <motion.g
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: [0, 0, 0, 0, 1, 1, 0] } : {}}
              transition={{ duration: DURATION, times: [0, 0.55, 0.6, 0.65, 0.7, 0.85, 0.95] }}
            >
              {[-28, -12, 12, 28].map((x, i) => (
                <motion.circle
                  key={i}
                  cx={x}
                  cy={0}
                  r="2.5"
                  fill="#fde047"
                  animate={{ scale: [0.4, 1.3, 0.4], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.65, repeat: Infinity, delay: i * 0.13 }}
                />
              ))}
            </motion.g>
          </g>

          {/* Payout bag flies in at end — larger bag so label fits */}
          <motion.g
            initial={{ opacity: 0, x: 460, y: 90, scale: 0.5 }}
            animate={
              inView
                ? {
                    opacity: [0, 0, 0, 1, 1],
                    x: [460, 460, 460, 460, 380],
                    y: [90, 90, 90, 30, 175],
                    scale: [0.5, 0.5, 0.5, 1, 1],
                  }
                : {}
            }
            transition={{ duration: DURATION, times: [0, 0.78, 0.83, 0.9, 1], ease: [0.5, 0, 0.3, 1] }}
          >
            <g>
              <ellipse cx="0" cy="20" rx="22" ry="3" fill="#000" opacity="0.18" />
              <path
                d="M -24 -4 Q -24 20 0 20 Q 24 20 24 -4 Q 19 -1 11 -1 L -11 -1 Q -19 -1 -24 -4 Z"
                fill="#86efac"
                stroke="#166534"
                strokeWidth="1.6"
              />
              <path d="M -24 -4 Q -22 6 0 6 Q 22 6 24 -4 L 24 4 L -24 4 Z" fill="#65d489" opacity="0.45" />
              <path d="M -11 -1 L -8 -9 L 8 -9 L 11 -1 Z" fill="#65d489" stroke="#166534" strokeWidth="1" />
              <path d="M -8 -9 Q -2 -13 2 -13 Q 8 -13 8 -9" fill="none" stroke="#166534" strokeWidth="1.6" />
              <text
                x="0"
                y="13"
                textAnchor="middle"
                fontSize="10.5"
                fontWeight="800"
                fill="#064e3b"
                letterSpacing="0.3"
                style={{ fontFamily: MONO }}
              >
                +{p.currencySymbol}{fmt(p.payout)}
              </text>
            </g>
          </motion.g>

          {/* "You got paid" badge */}
          <g transform="translate(490, 218)">
            <motion.g
              initial={{ opacity: 0, scale: 0.5, y: 30 }}
              animate={inView ? { opacity: [0, 0, 0, 0, 1], scale: [0.5, 0.5, 0.5, 0.5, 1], y: [30, 30, 30, 30, 0] } : {}}
              transition={{ duration: DURATION, times: [0, 0.75, 0.85, 0.92, 0.97], ease: [0.2, 0.8, 0.4, 1] }}
            >
              <rect x="-72" y="-18" width="144" height="36" rx="18" fill="#16a34a" />
              <rect x="-72" y="-18" width="144" height="18" rx="18" fill="#22c55e" opacity="0.5" />
              <text
                x="0"
                y="5"
                textAnchor="middle"
                fontSize="11.5"
                fontWeight="800"
                fill="#fff"
                letterSpacing="0.6"
                style={{ fontFamily: FONT }}
              >
                YOU GOT PAID
              </text>
            </motion.g>
          </g>
        </svg>
      </div>

      <p className="text-center text-xs text-gray-400 mt-3 italic">
        Small fee in. Big protection out — like insurance, for currencies.
      </p>
    </div>
  );
}

function CharacterMoodSwap({ inView, duration }: { inView: boolean; duration: number }) {
  return (
    <>
      <motion.g
        initial={{ opacity: 1 }}
        animate={inView ? { opacity: [1, 1, 0, 0, 0, 1] } : {}}
        transition={{ duration, times: [0, 0.55, 0.6, 0.7, 0.9, 0.95] }}
      >
        <Character mood="happy" />
      </motion.g>
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1, 1, 0] } : {}}
        transition={{ duration, times: [0, 0.55, 0.6, 0.7, 0.75] }}
      >
        <Character mood="worried" />
      </motion.g>
    </>
  );
}
