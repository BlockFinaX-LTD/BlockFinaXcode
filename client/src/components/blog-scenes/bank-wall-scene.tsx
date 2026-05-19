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

const FONT = "Inter, system-ui, -apple-system, sans-serif";

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function BankWallScene({ barriers }: Props) {
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const totalAnimation = 2.5 + barriers.length * 1.2 + 2;

  return (
    <div ref={ref} className="my-8">
      <div className="relative overflow-hidden rounded-3xl border border-blue-100 aspect-[2/1] sm:aspect-[2.4/1] shadow-sm">
        <svg viewBox="0 0 600 250" className="w-full h-full block" preserveAspectRatio="xMidYMid meet" style={{ fontFamily: FONT }}>
          <defs>
            <linearGradient id="bankSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#bcd7f5" />
              <stop offset="100%" stopColor="#eef3fb" />
            </linearGradient>
            <linearGradient id="bankFacade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ece7dc" />
              <stop offset="100%" stopColor="#c8c1b3" />
            </linearGradient>
            <linearGradient id="bankRoof" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#374151" />
              <stop offset="100%" stopColor="#1f2937" />
            </linearGradient>
            <linearGradient id="bankGround" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d6dce4" />
              <stop offset="100%" stopColor="#aab4c0" />
            </linearGradient>
          </defs>

          <rect width="600" height="195" fill="url(#bankSky)" />
          <rect y="195" width="600" height="55" fill="url(#bankGround)" />
          <rect y="195" width="600" height="2" fill="#94a0ae" opacity="0.6" />

          {/* Bank building — right side */}
          <g transform="translate(430, 60)">
            {/* Pediment */}
            <path d="M -85 0 L 85 0 L 72 -28 L -72 -28 Z" fill="url(#bankRoof)" />
            <text
              x="0"
              y="-9"
              textAnchor="middle"
              fontSize="11"
              fontWeight="800"
              fill="#fde68a"
              letterSpacing="2"
              style={{ fontFamily: FONT }}
            >
              BANK
            </text>

            {/* Facade */}
            <rect x="-85" y="0" width="170" height="135" fill="url(#bankFacade)" stroke="#9b937e" strokeWidth="1" />

            {/* Columns */}
            {[-65, -32.5, 0, 32.5, 65].map((x, i) => (
              <g key={i}>
                <rect x={x - 4} y="0" width="8" height="135" fill="#f4eee0" />
                <rect x={x - 5} y="0" width="10" height="6" fill="#9b937e" />
                <rect x={x - 5} y="129" width="10" height="6" fill="#9b937e" />
              </g>
            ))}

            {/* Steps */}
            <rect x="-96" y="135" width="192" height="4" fill="#9b937e" />
            <rect x="-104" y="139" width="208" height="4" fill="#7c7460" />

            {/* Money emblem */}
            <circle cx="0" cy="52" r="13" fill="#fef3c7" stroke="#92400e" strokeWidth="1.5" />
            <text
              x="0"
              y="57"
              textAnchor="middle"
              fontSize="16"
              fontWeight="800"
              fill="#92400e"
              style={{ fontFamily: FONT }}
            >
              $
            </text>

            {/* Door */}
            <rect x="-13" y="80" width="26" height="55" fill="#3d2818" rx="2" />
            <circle cx="7" cy="108" r="1.5" fill="#fbbf24" />
            <line x1="0" y1="80" x2="0" y2="135" stroke="#1f1408" strokeWidth="0.5" opacity="0.5" />

            {/* Grumpy banker peeking out the door */}
            <motion.g
              initial={{ y: 70 }}
              animate={inView ? { y: [70, 70, 88, 88] } : {}}
              transition={{ duration: totalAnimation, times: [0, 0.18, 0.24, 1] }}
              clipPath="url(#bankerClip)"
            >
              {/* Head */}
              <circle cx="0" cy="92" r="11" fill="#f4c89c" />
              {/* Hair */}
              <path d="M -10 86 Q -8 80 0 80 Q 8 80 10 86 Q 9 89 6 88 Q 0 84 -6 88 Q -9 89 -10 86 Z" fill="#1f2937" />
              {/* Eyes */}
              <circle cx="-3.5" cy="91" r="1.4" fill="#1f2937" />
              <circle cx="3.5" cy="91" r="1.4" fill="#1f2937" />
              {/* Angry eyebrows */}
              <path d="M -6 88 L -1 89" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M 1 89 L 6 88" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" />
              {/* Frown */}
              <path d="M -3 96 Q 0 94 3 96" stroke="#1f2937" strokeWidth="1.4" strokeLinecap="round" fill="none" />
            </motion.g>
            <defs>
              <clipPath id="bankerClip">
                <rect x="-13" y="80" width="26" height="55" />
              </clipPath>
            </defs>
          </g>

          {/* Minimum sign on the steps */}
          <g transform="translate(430, 207)">
            <motion.g
              initial={{ opacity: 0, scale: 0.4, rotate: -8 }}
              animate={inView ? { opacity: 1, scale: 1, rotate: 0 } : {}}
              transition={{ delay: 0.3, type: "spring", stiffness: 220, damping: 14 }}
            >
              <rect x="-58" y="-8" width="116" height="20" rx="3" fill="#fcd34d" stroke="#92400e" strokeWidth="1.5" />
              <text
                x="0"
                y="6"
                textAnchor="middle"
                fontSize="9"
                fontWeight="800"
                fill="#7c2d12"
                letterSpacing="0.6"
                style={{ fontFamily: FONT }}
              >
                MIN DEAL: $100,000
              </text>
            </motion.g>
          </g>

          {/* Character walking */}
          <CharacterWalk inView={inView} totalDuration={totalAnimation} />

          {/* Speech bubbles popping from bank */}
          {barriers.map((b, i) => {
            const start = 2.2 + i * 1.2;
            const fadeOut = start + 0.9;
            return (
              <motion.g
                key={i}
                initial={{ opacity: 0, scale: 0 }}
                animate={
                  inView
                    ? {
                        opacity: [0, 0, 1, 1, 0],
                        scale: [0, 0, 1, 1, 0.85],
                      }
                    : {}
                }
                transition={{
                  duration: totalAnimation,
                  times: [
                    0,
                    start / totalAnimation,
                    (start + 0.25) / totalAnimation,
                    fadeOut / totalAnimation,
                    (fadeOut + 0.4) / totalAnimation,
                  ],
                }}
                style={{ transformOrigin: `${300 - i * 6}px ${75 + i * 38}px` }}
              >
                <BarrierBubble
                  x={290 - i * 4}
                  y={70 + i * 38}
                  title={b.title}
                  detail={b.detail}
                />
              </motion.g>
            );
          })}
        </svg>
      </div>

      <p className="text-center text-xs text-gray-400 mt-3 italic">
        You'd hedge if you could — the bank just doesn't want your business.
      </p>
    </div>
  );
}

function BarrierBubble({ x, y, title, detail }: { x: number; y: number; title: string; detail: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Tail pointing right toward bank */}
      <path d="M 152 18 L 170 22 L 152 26 Z" fill="#fff" stroke="#dc2626" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Bubble */}
      <rect x="0" y="0" width="154" height="44" rx="10" fill="#ffffff" stroke="#dc2626" strokeWidth="1.5" />
      {/* X icon */}
      <circle cx="16" cy="22" r="10" fill="#dc2626" />
      <path d="M 11 17 L 21 27 M 21 17 L 11 27" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      {/* Title */}
      <text
        x="32"
        y="18"
        fontSize="9.5"
        fontWeight="800"
        fill="#1f2937"
        letterSpacing="0.1"
        style={{ fontFamily: FONT }}
      >
        {truncate(title, 22)}
      </text>
      {/* Detail */}
      <text
        x="32"
        y="32"
        fontSize="7.5"
        fontWeight="500"
        fill="#6b7280"
        style={{ fontFamily: FONT }}
      >
        {truncate(detail, 28)}
      </text>
    </g>
  );
}

function CharacterWalk({ inView, totalDuration }: { inView: boolean; totalDuration: number }) {
  const arrive = 1.8;
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
        <motion.g
          initial={{ opacity: 1 }}
          animate={inView ? { opacity: [1, 1, 0, 0] } : {}}
          transition={{ duration: totalDuration, times: [0, arrive / totalDuration, (arrive + 0.2) / totalDuration, 1] }}
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
              (leave - 0.4) / totalDuration,
              leave / totalDuration,
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

        {/* Briefcase, gently swinging while walking */}
        <motion.g
          animate={{ rotate: [-2, 2, -2] }}
          transition={{ duration: 0.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ transformOrigin: "31px 14px" }}
        >
          <rect x="22" y="14" width="18" height="14" rx="2" fill="#5b3a1d" />
          <rect x="27" y="10" width="8" height="5" fill="none" stroke="#5b3a1d" strokeWidth="2" />
          <circle cx="31" cy="21" r="0.8" fill="#fde047" />
        </motion.g>
      </g>
    </motion.g>
  );
}
