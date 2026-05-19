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

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export function InsuranceFlowScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const DURATION = 7;

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#e8f0fa] via-[#f0f6fe] to-[#dde9f7] border border-blue-100 aspect-[2/1] sm:aspect-[2.4/1]">
        <svg viewBox="0 0 600 250" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="insSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcd7f5" />
              <stop offset="100%" stopColor="#eef3fb" />
            </linearGradient>
            <radialGradient id="shieldGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4a90e2" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#4a90e2" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="600" height="195" fill="url(#insSky)" />
          <rect y="195" width="600" height="55" fill="#d1d8de" />
          <rect y="195" width="600" height="2.5" fill="#a3acb5" />

          {/* Step 1: Coin flying in from left to a piggy bank */}
          <motion.g
            initial={{ x: -100, y: -10, opacity: 0 }}
            animate={inView ? { x: [-100, 120, 120], y: [-10, -10, 70], opacity: [0, 1, 1, 0] } : {}}
            transition={{ duration: DURATION, times: [0, 0.12, 0.22, 0.3] }}
          >
            <g transform="translate(0, 100)">
              <circle r="14" fill="#fcd34d" stroke="#a16207" strokeWidth="1.5" />
              <circle r="11" fill="none" stroke="#a16207" strokeWidth="0.8" />
              <text x="0" y="4" textAnchor="middle" fontSize="14" fontWeight="800" fill="#7c2d12">$</text>
            </g>
          </motion.g>

          {/* Piggy bank / vault on left */}
          <g transform="translate(120, 170)">
            <ellipse cx="0" cy="2" rx="38" ry="6" fill="#000" opacity="0.15" />
            <ellipse cx="0" cy="-12" rx="36" ry="26" fill="#f7a8c4" stroke="#9d3e62" strokeWidth="1.5" />
            <ellipse cx="-22" cy="-12" rx="6" ry="8" fill="#9d3e62" />
            <rect x="-2" y="-32" width="4" height="3" rx="0.5" fill="#3a2410" />
            <circle cx="-10" cy="-15" r="1.8" fill="#3a2410" />
            <ellipse cx="20" cy="-8" rx="4" ry="3" fill="#9d3e62" />
            <circle cx="19" cy="-9" r="0.8" fill="#1f2937" />
            <circle cx="22" cy="-9" r="0.8" fill="#1f2937" />
            <path d="M -30 -25 L -25 -32" stroke="#9d3e62" strokeWidth="3" strokeLinecap="round" />
            <path d="M -32 -22 L -29 -29" stroke="#9d3e62" strokeWidth="3" strokeLinecap="round" />
            {/* Legs */}
            <rect x="-25" y="10" width="5" height="6" fill="#9d3e62" />
            <rect x="20" y="10" width="5" height="6" fill="#9d3e62" />
            <text x="0" y="0" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" opacity="0.6">PREMIUM</text>
          </g>

          {/* Character in middle */}
          <g transform="translate(300, 175)">
            <CharacterMoodLine inView={inView} duration={DURATION} />
          </g>

          {/* Shield appearing around character */}
          <motion.g
            initial={{ opacity: 0, scale: 0.4 }}
            animate={inView ? { opacity: [0, 0, 1, 1, 1, 1], scale: [0.4, 0.4, 1, 1, 1, 1] } : {}}
            transition={{ duration: DURATION, times: [0, 0.3, 0.38, 0.6, 0.85, 1] }}
            transform="translate(300, 145)"
          >
            <motion.g animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
              <circle r="60" fill="url(#shieldGlow)" />
              {/* Shield body */}
              <path
                d="M 0 -42 L 36 -28 L 36 5 Q 36 32 0 48 Q -36 32 -36 5 L -36 -28 Z"
                fill="#4a90e2"
                fillOpacity="0.18"
                stroke="#1a4480"
                strokeWidth="2"
              />
              <path
                d="M 0 -38 L 32 -25 L 32 4 Q 32 28 0 42 Q -32 28 -32 4 L -32 -25 Z"
                fill="none"
                stroke="#4a90e2"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />
              {/* Checkmark inside */}
              <path d="M -10 0 L -2 10 L 14 -10" stroke="#1a4480" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </motion.g>
          </motion.g>

          {/* Storm cloud rolls in over character */}
          <motion.g
            initial={{ x: 700, opacity: 0 }}
            animate={inView ? { x: 0, opacity: 1 } : {}}
            transition={{ duration: 1.5, delay: 4.0, ease: "easeOut" }}
          >
            <g transform="translate(300, 50)">
              <ellipse cx="0" cy="0" rx="50" ry="20" fill="#4a5568" />
              <ellipse cx="-28" cy="-10" rx="25" ry="18" fill="#5a6473" />
              <ellipse cx="22" cy="-12" rx="28" ry="20" fill="#5a6473" />
              <ellipse cx="-8" cy="-16" rx="22" ry="16" fill="#6b7785" />
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
                    stroke="#5a8fc7"
                    strokeWidth="2"
                    strokeLinecap="round"
                    animate={{ opacity: [1, 0.2, 1] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.1 }}
                  />
                ))}
              </motion.g>
            </g>
          </motion.g>

          {/* Rain deflecting off shield (sparks) */}
          <motion.g
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: [0, 0, 0, 0, 1, 1, 0] } : {}}
            transition={{ duration: DURATION, times: [0, 0.55, 0.6, 0.65, 0.7, 0.85, 0.95] }}
            transform="translate(300, 110)"
          >
            {[-25, -10, 10, 25].map((x, i) => (
              <motion.g
                key={i}
                animate={{ scale: [0.6, 1.2, 0.6], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
              >
                <circle cx={x} cy={0} r="2.5" fill="#fde047" />
              </motion.g>
            ))}
          </motion.g>

          {/* Payout bag flies from shield to character at end */}
          <motion.g
            initial={{ opacity: 0, x: 380, y: 120, scale: 0.6 }}
            animate={inView ? { opacity: [0, 0, 0, 1, 1], x: [380, 380, 380, 380, 340], y: [120, 120, 120, 60, 175], scale: [0.6, 0.6, 0.6, 1, 1] } : {}}
            transition={{ duration: DURATION, times: [0, 0.75, 0.8, 0.88, 1] }}
          >
            <g transform="translate(0, 0)">
              <ellipse cx="0" cy="14" rx="14" ry="2" fill="#000" opacity="0.18" />
              <path
                d="M -15 -4 Q -15 14 0 14 Q 15 14 15 -4 Q 12 -1 7 -1 L -7 -1 Q -12 -1 -15 -4 Z"
                fill="#86efac"
                stroke="#166534"
                strokeWidth="1.2"
              />
              <path d="M -7 -1 L -5 -7 L 5 -7 L 7 -1 Z" fill="#65d489" />
              <path d="M -5 -7 Q -1 -10 1 -10 Q 5 -10 5 -7" fill="none" stroke="#166534" strokeWidth="1.2" />
              <text x="0" y="8" textAnchor="middle" fontSize="9" fontWeight="800" fill="#064e3b">
                +{p.currencySymbol}{fmt(p.payout)}
              </text>
            </g>
          </motion.g>

          {/* Big "PAID OUT" / "PROTECTED" label at end */}
          <motion.g
            initial={{ opacity: 0, scale: 0.5 }}
            animate={inView ? { opacity: [0, 0, 0, 0, 1], scale: [0.5, 0.5, 0.5, 0.5, 1] } : {}}
            transition={{ duration: DURATION, times: [0, 0.7, 0.8, 0.9, 0.95] }}
          >
            <g transform="translate(480, 200)">
              <rect x="-65" y="-15" width="130" height="30" rx="15" fill="#22c55e" />
              <text x="0" y="6" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" letterSpacing="0.5">
                YOU GOT PAID
              </text>
            </g>
          </motion.g>

          {/* Premium label sticker top-left */}
          <g transform="translate(60, 50)">
            <motion.g initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.2 }}>
              <rect x="-40" y="-13" width="100" height="26" rx="4" fill="#fff" stroke="#1a4480" strokeWidth="1.5" />
              <text x="-30" y="5" fontSize="9" fontWeight="700" fill="#6b7280">PREMIUM</text>
              <text x="55" y="5" textAnchor="end" fontSize="12" fontWeight="800" fill="#1a4480" style={{ fontFamily: "ui-monospace, monospace" }}>
                {p.currencySymbol}{fmt(p.premium)}
              </text>
            </motion.g>
          </g>

          {/* Days label top-right */}
          <g transform="translate(540, 50)">
            <motion.g initial={{ opacity: 0 }} animate={inView ? { opacity: 1 } : {}} transition={{ delay: 0.4 }}>
              <rect x="-40" y="-13" width="80" height="26" rx="13" fill="#1a4480" />
              <text x="0" y="5" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{p.days} DAYS</text>
            </motion.g>
          </g>
        </svg>
      </div>

      <p className="text-center text-xs text-gray-400 mt-2">
        Small fee in. Big protection out — like insurance, for currencies.
      </p>
    </div>
  );
}

function CharacterMoodLine({ inView, duration }: { inView: boolean; duration: number }) {
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
