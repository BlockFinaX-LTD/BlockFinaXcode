import { motion } from "framer-motion";
import { useInView } from "./use-in-view";
import { Character } from "./character";

interface Barrier {
  title: string;
  detail: string;
}

interface Props {
  barriers: Barrier[];
}

export function BankWallScene({ barriers }: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const totalAnimation = 2 + barriers.length * 1.2 + 2;

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#dde9f7] via-[#eef3fb] to-[#dbe6f3] border border-blue-100 aspect-[2/1] sm:aspect-[2.4/1]">
        <svg viewBox="0 0 600 250" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="bankFacade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8e4dc" />
              <stop offset="100%" stopColor="#c8c1b3" />
            </linearGradient>
            <linearGradient id="bankRoof" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#374151" />
              <stop offset="100%" stopColor="#1f2937" />
            </linearGradient>
            <linearGradient id="bankSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcd7f5" />
              <stop offset="100%" stopColor="#eef3fb" />
            </linearGradient>
          </defs>

          <rect width="600" height="195" fill="url(#bankSky)" />
          <rect y="195" width="600" height="55" fill="#cdc7b8" />
          <rect y="195" width="600" height="2.5" fill="#9b937e" />

          {/* Bank building */}
          <g transform="translate(420, 60)">
            {/* Roof / pediment */}
            <path d="M -80 0 L 80 0 L 70 -25 L -70 -25 Z" fill="url(#bankRoof)" />
            <text x="0" y="-7" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fde68a" letterSpacing="1">BANK</text>

            {/* Facade */}
            <rect x="-80" y="0" width="160" height="135" fill="url(#bankFacade)" stroke="#9b937e" strokeWidth="1" />

            {/* Columns */}
            {[-60, -30, 0, 30, 60].map((x, i) => (
              <g key={i}>
                <rect x={x - 4} y="0" width="8" height="135" fill="#f0eadd" />
                <rect x={x - 5} y="0" width="10" height="6" fill="#9b937e" />
                <rect x={x - 5} y="129" width="10" height="6" fill="#9b937e" />
              </g>
            ))}

            {/* Steps */}
            <rect x="-92" y="135" width="184" height="4" fill="#9b937e" />
            <rect x="-100" y="139" width="200" height="4" fill="#7c7460" />

            {/* Money symbol on facade */}
            <circle cx="0" cy="55" r="14" fill="#fef3c7" stroke="#92400e" strokeWidth="1.5" />
            <text x="0" y="60" textAnchor="middle" fontSize="18" fontWeight="800" fill="#92400e">$</text>

            {/* Door */}
            <rect x="-12" y="80" width="24" height="55" fill="#3d2818" rx="2" />
            <circle cx="6" cy="108" r="1.5" fill="#fbbf24" />

            {/* Banker peeking out, grumpy */}
            <motion.g
              initial={{ y: 60 }}
              animate={inView ? { y: [60, 60, 92, 92] } : {}}
              transition={{ duration: totalAnimation, times: [0, 0.15, 0.2, 1] }}
            >
              <g transform="translate(0, 0)" clipPath="url(#doorClip)">
                {/* Head only */}
                <circle cx="0" cy="92" r="11" fill="#f4c89c" />
                <rect x="-6" y="82" width="12" height="4" fill="#1f2937" />
                <circle cx="-3.5" cy="91" r="1.4" fill="#1f2937" />
                <circle cx="3.5" cy="91" r="1.4" fill="#1f2937" />
                <path d="M -3 96 L 3 96" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
                {/* Eyebrows angry */}
                <path d="M -6 88 L -1 89" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M 1 89 L 6 88" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
              </g>
              <defs>
                <clipPath id="doorClip">
                  <rect x="-12" y="80" width="24" height="55" />
                </clipPath>
              </defs>
            </motion.g>
          </g>

          {/* Sign: minimum $100k */}
          <motion.g
            initial={{ opacity: 0, scale: 0 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ delay: 0.2, duration: 0.5 }}
            transform="translate(420, 200)"
          >
            <rect x="-50" y="-5" width="100" height="20" rx="3" fill="#fcd34d" stroke="#92400e" strokeWidth="1.5" />
            <text x="0" y="9" textAnchor="middle" fontSize="9" fontWeight="700" fill="#7c2d12">MIN $100,000</text>
          </motion.g>

          {/* Character walking in from left, then walking back */}
          <CharacterWalk barriers={barriers} inView={inView} totalDuration={totalAnimation} />

          {/* Barriers — speech bubbles popping from bank */}
          {barriers.map((b, i) => {
            const start = 2 + i * 1.2;
            const fadeOut = start + 0.9;
            return (
              <motion.g
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                animate={
                  inView
                    ? {
                        opacity: [0, 0, 1, 1, 0],
                        scale: [0, 0, 1, 1, 0.8],
                      }
                    : {}
                }
                transition={{
                  duration: totalAnimation,
                  times: [0, start / totalAnimation, (start + 0.2) / totalAnimation, fadeOut / totalAnimation, (fadeOut + 0.4) / totalAnimation],
                }}
              >
                <BarrierBubble
                  x={320 - i * 6}
                  y={70 + i * 38}
                  index={i + 1}
                  title={b.title}
                  detail={b.detail}
                />
              </motion.g>
            );
          })}
        </svg>
      </div>
      <p className="text-center text-xs text-gray-400 mt-2">
        You'd hedge if you could — the bank just doesn't want your business.
      </p>
    </div>
  );
}

function BarrierBubble({ x, y, index, title, detail }: { x: number; y: number; index: number; title: string; detail: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Tail pointing right to the bank */}
      <path d={`M 140 18 L 158 22 L 140 26 Z`} fill="#fff" stroke="#dc2626" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Bubble */}
      <rect x="0" y="0" width="142" height="44" rx="10" fill="#fff" stroke="#dc2626" strokeWidth="1.5" />
      {/* X icon */}
      <circle cx="14" cy="22" r="9" fill="#dc2626" />
      <path d="M 10 18 L 18 26 M 18 18 L 10 26" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
      {/* Text */}
      <text x="28" y="18" fontSize="9" fontWeight="800" fill="#1f2937">
        {truncate(title, 22)}
      </text>
      <text x="28" y="31" fontSize="7.5" fill="#6b7280">
        {truncate(detail, 28)}
      </text>
    </g>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function CharacterWalk({ inView, totalDuration }: { barriers: Barrier[]; inView: boolean; totalDuration: number }) {
  // Walk in (0 → 1.5s), stand still while barriers pop (1.5 → totalDuration-2s), walk away (last 2s)
  const arrive = 1.5;
  const leave = totalDuration - 2;
  return (
    <motion.g
      initial={{ x: -80 }}
      animate={inView ? { x: [-80, 200, 200, -80] } : {}}
      transition={{
        duration: totalDuration,
        times: [0, arrive / totalDuration, leave / totalDuration, 1],
        ease: "easeInOut",
      }}
    >
      <g transform="translate(0, 195)">
        {/* Mood switches sad after barriers */}
        <motion.g
          initial={{ opacity: 1 }}
          animate={inView ? { opacity: [1, 1, 0, 0] } : {}}
          transition={{ duration: totalDuration, times: [0, 0.25, 0.27, 1] }}
        >
          <Character mood="happy" />
        </motion.g>
        <motion.g
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: [0, 0, 1, 1, 0] } : {}}
          transition={{
            duration: totalDuration,
            times: [
              0,
              arrive / totalDuration,
              (arrive + 0.2) / totalDuration,
              ((leave - 0.5) / totalDuration),
              (leave / totalDuration),
            ],
          }}
        >
          <Character mood="worried" />
        </motion.g>
        <motion.g
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: [0, 0, 1] } : {}}
          transition={{ duration: totalDuration, times: [0, (leave - 0.4) / totalDuration, leave / totalDuration] }}
        >
          <Character mood="sad" facing={-1} />
        </motion.g>

        {/* Briefcase */}
        <motion.g
          initial={{ rotate: -2 }}
          animate={inView ? { rotate: [-2, 2, -2] } : {}}
          transition={{ duration: 0.4, repeat: Infinity }}
        >
          <rect x="22" y="14" width="18" height="14" rx="2" fill="#5b3a1d" />
          <rect x="27" y="10" width="8" height="5" fill="none" stroke="#5b3a1d" strokeWidth="2" />
          <circle cx="31" cy="21" r="0.8" fill="#fde047" />
        </motion.g>
      </g>
    </motion.g>
  );
}
