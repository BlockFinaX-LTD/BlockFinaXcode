import { motion } from "framer-motion";
import { useInView } from "./use-in-view";
import { Character } from "./character";
import { Banknote, Umbrella, FloatingNumber } from "./objects";

interface Props {
  premium: number;
  protected: number;
  days: number;
  payout: number;
  currencySymbol: string;
}

const FONT = "Inter, system-ui, -apple-system, sans-serif";

function fmt(n: number) {
  return n.toLocaleString("en-US");
}

export function InsuranceFlowScene(p: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const DURATION = 8;

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
              <stop offset="0%" stopColor="#dde3eb" />
              <stop offset="100%" stopColor="#b5c0cc" />
            </linearGradient>
            <radialGradient id="sunGlow2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe17a" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#ffe17a" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width="600" height="195" fill="url(#insSky)" />
          <rect y="195" width="600" height="55" fill="url(#insGround)" />
          <rect y="195" width="600" height="2" fill="#94a0ae" opacity="0.6" />

          {/* Friendly sun, fades slightly when storm rolls in */}
          <motion.g
            initial={{ opacity: 1 }}
            animate={inView ? { opacity: [1, 1, 0.55, 0.55, 1] } : {}}
            transition={{ duration: DURATION, times: [0, 0.45, 0.55, 0.85, 0.95] }}
          >
            <circle cx="80" cy="55" r="42" fill="url(#sunGlow2)" />
            <circle cx="80" cy="55" r="18" fill="#ffd24c" />
            <circle cx="80" cy="55" r="11" fill="#ffe082" />
          </motion.g>

          {/* Character holding a $750 banknote at the start */}
          <g transform="translate(280, 175)">
            <CharacterMoods inView={inView} duration={DURATION} />
          </g>

          {/* Premium banknote — starts in character's hand, flies off to the right (paid) */}
          <motion.g
            initial={{ x: 305, y: 168, opacity: 0, rotate: 0 }}
            animate={
              inView
                ? {
                    x: [305, 305, 480, 620],
                    y: [168, 168, 140, 110],
                    opacity: [0, 1, 1, 0],
                    rotate: [0, 0, 12, 25],
                  }
                : {}
            }
            transition={{ duration: DURATION, times: [0, 0.08, 0.28, 0.35], ease: [0.4, 0, 0.3, 1] }}
          >
            <Banknote amount={`${p.currencySymbol}${fmt(p.premium)}`} scale={0.85} />
          </motion.g>

          {/* Small "premium paid" floating callout */}
          <g transform="translate(440, 130)">
            <FloatingNumber
              text="premium paid"
              color="#1a4480"
              fontSize={11}
              startDelay={2.4}
              startY={0}
              endY={-30}
              duration={1.6}
              trigger={inView}
            />
          </g>

          {/* Umbrella drops in over the character and opens with a spring */}
          <g transform="translate(280, 130)">
            <motion.g
              initial={{ opacity: 0, y: -80, scale: 0.3 }}
              animate={
                inView
                  ? {
                      opacity: [0, 0, 0, 1, 1, 1, 1],
                      y: [-80, -80, -80, 0, 0, 0, 0],
                      scale: [0.3, 0.3, 0.3, 1, 1, 1, 1],
                    }
                  : {}
              }
              transition={{
                duration: DURATION,
                times: [0, 0.36, 0.4, 0.5, 0.6, 0.85, 1],
                ease: [0.2, 0.9, 0.4, 1.05],
              }}
            >
              <motion.g
                animate={inView ? { y: [0, -2, 0] } : {}}
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", delay: 4.2 }}
              >
                <Umbrella scale={1.05} />
              </motion.g>
            </motion.g>
          </g>

          {/* Storm cloud rolls in over the umbrella */}
          <motion.g
            initial={{ x: 700 }}
            animate={inView ? { x: 0 } : {}}
            transition={{ delay: 4.4, type: "spring", stiffness: 42, damping: 13, mass: 1.1 }}
          >
            <g transform="translate(280, 50)">
              <ellipse cx="0" cy="0" rx="58" ry="22" fill="#475569" />
              <ellipse cx="-32" cy="-9" rx="28" ry="20" fill="#64748b" />
              <ellipse cx="28" cy="-11" rx="32" ry="22" fill="#64748b" />
              <ellipse cx="-8" cy="-18" rx="26" ry="18" fill="#7e8b9c" />
              {/* Rain falling between cloud and umbrella */}
              <motion.g
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: [0, 0, 0, 1] } : {}}
                transition={{ duration: DURATION, times: [0, 0.6, 0.65, 0.7] }}
              >
                {[-30, -16, 0, 14, 28].map((x, i) => (
                  <motion.line
                    key={i}
                    x1={x}
                    y1={10}
                    x2={x - 2}
                    y2={32}
                    stroke="#7aaad8"
                    strokeWidth="2"
                    strokeLinecap="round"
                    animate={{ opacity: [0.9, 0.3, 0.9] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.1 }}
                  />
                ))}
              </motion.g>
            </g>
          </motion.g>

          {/* Splash droplets where rain hits the umbrella */}
          <g transform="translate(280, 100)">
            <motion.g
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: [0, 0, 0, 0, 1, 1, 0] } : {}}
              transition={{ duration: DURATION, times: [0, 0.6, 0.66, 0.7, 0.72, 0.88, 0.94] }}
            >
              {[-32, -16, 0, 16, 32].map((x, i) => (
                <motion.g
                  key={i}
                  animate={{ y: [0, -4, 0], opacity: [0.3, 1, 0.3], scale: [0.7, 1.1, 0.7] }}
                  transition={{ duration: 0.65, repeat: Infinity, delay: i * 0.12 }}
                >
                  <circle cx={x} cy={0} r="2.2" fill="#7aaad8" />
                  <circle cx={x - 4} cy={2} r="1" fill="#7aaad8" opacity="0.7" />
                  <circle cx={x + 4} cy={2} r="1" fill="#7aaad8" opacity="0.7" />
                </motion.g>
              ))}
            </motion.g>
          </g>

          {/* Payout: a small flock of green banknotes rains down to the character */}
          {[0, 1, 2, 3].map(i => (
            <motion.g
              key={i}
              initial={{ x: 280 + (i - 1.5) * 14, y: -30, opacity: 0, rotate: -15 + i * 8 }}
              animate={
                inView
                  ? {
                      x: [280 + (i - 1.5) * 14, 280 + (i - 1.5) * 18, 280 + (i - 1.5) * 22],
                      y: [-30, 80, 178],
                      opacity: [0, 1, 1],
                      rotate: [-15 + i * 8, -8 + i * 5, 0],
                    }
                  : {}
              }
              transition={{
                delay: 6.4 + i * 0.18,
                duration: 1.2,
                times: [0, 0.55, 1],
                ease: [0.35, 0, 0.25, 1],
              }}
            >
              <Banknote amount={`${p.currencySymbol}${fmt(Math.round(p.payout / 4))}`} scale={0.7} />
            </motion.g>
          ))}

          {/* Floating green payout number rises from the character at the end */}
          <g transform="translate(280, 140)">
            <FloatingNumber
              text={`+${p.currencySymbol}${fmt(p.payout)}`}
              color="#16a34a"
              fontSize={22}
              startDelay={7.0}
              startY={0}
              endY={-60}
              duration={2.0}
              trigger={inView}
            />
          </g>
        </svg>
      </div>

      <p className="text-center text-xs text-gray-400 mt-3 italic">
        Small fee in. Big protection out — like insurance, for currencies.
      </p>
    </div>
  );
}

function CharacterMoods({ inView, duration }: { inView: boolean; duration: number }) {
  return (
    <>
      {/* Happy → while paying premium and during the calm */}
      <motion.g
        initial={{ opacity: 1 }}
        animate={inView ? { opacity: [1, 1, 0, 0, 0, 1] } : {}}
        transition={{ duration, times: [0, 0.55, 0.6, 0.7, 0.85, 0.92] }}
      >
        <Character mood="happy" />
      </motion.g>
      {/* Briefly worried when the storm rolls in, before the umbrella + payout reassures them */}
      <motion.g
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: [0, 0, 1, 1, 0] } : {}}
        transition={{ duration, times: [0, 0.55, 0.62, 0.78, 0.85] }}
      >
        <Character mood="worried" />
      </motion.g>
    </>
  );
}
