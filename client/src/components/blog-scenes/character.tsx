import { motion } from "framer-motion";

export type Mood = "happy" | "worried" | "sad" | "shocked";

const skin = "#f4c89c";
const skinDark = "#d49860";
const hair = "#2b1d12";
const shirt = "#1a4480";
const shirtDark = "#143868";
const pants = "#374151";

function Mouth({ mood }: { mood: Mood }) {
  if (mood === "happy") {
    return <path d="M -5 -3 Q 0 2 5 -3" stroke="#3a2410" strokeWidth="1.6" strokeLinecap="round" fill="none" />;
  }
  if (mood === "worried") {
    return <path d="M -5 -2 Q 0 -3 5 -2" stroke="#3a2410" strokeWidth="1.6" strokeLinecap="round" fill="none" />;
  }
  if (mood === "sad") {
    return <path d="M -5 -1 Q 0 -5 5 -1" stroke="#3a2410" strokeWidth="1.6" strokeLinecap="round" fill="none" />;
  }
  return <ellipse cx="0" cy="-2" rx="2.5" ry="3" fill="#3a2410" />;
}

interface CharacterProps {
  mood: Mood;
  /** -1 to 1; turn body toward direction */
  facing?: number;
  scale?: number;
}

export function Character({ mood, facing = 0, scale = 1 }: CharacterProps) {
  return (
    <g transform={`scale(${scale}) translate(${facing * 1.2}, 0)`}>
      {/* Shadow */}
      <ellipse cx="0" cy="58" rx="22" ry="4" fill="#000" opacity="0.12" />

      {/* Legs */}
      <rect x="-9" y="32" width="7" height="24" rx="3" fill={pants} />
      <rect x="2" y="32" width="7" height="24" rx="3" fill={pants} />

      {/* Shirt / torso */}
      <path
        d="M -16 -2 Q -16 30 -14 36 L 14 36 Q 16 30 16 -2 Q 8 -10 0 -10 Q -8 -10 -16 -2 Z"
        fill={shirt}
      />
      <path d="M -16 -2 Q -10 6 0 6 Q 10 6 16 -2 L 16 8 L -16 8 Z" fill={shirtDark} opacity="0.4" />

      {/* Arms */}
      <rect x="-22" y="-2" width="7" height="26" rx="3.5" fill={shirt} />
      <rect x="15" y="-2" width="7" height="26" rx="3.5" fill={shirt} />
      {/* Hands */}
      <circle cx="-18.5" cy="26" r="4.5" fill={skin} />
      <circle cx="18.5" cy="26" r="4.5" fill={skin} />

      {/* Neck */}
      <rect x="-4" y="-12" width="8" height="6" fill={skinDark} />

      {/* Head */}
      <circle cx="0" cy="-22" r="14" fill={skin} />
      {/* Hair */}
      <path d="M -13 -26 Q -10 -36 0 -36 Q 10 -36 13 -26 Q 12 -22 8 -23 Q 0 -29 -8 -23 Q -12 -22 -13 -26 Z" fill={hair} />
      {/* Ears */}
      <ellipse cx="-13" cy="-21" rx="2.5" ry="3.5" fill={skinDark} />
      <ellipse cx="13" cy="-21" rx="2.5" ry="3.5" fill={skinDark} />

      {/* Eyes */}
      <circle cx="-5" cy="-22" r="2" fill="#3a2410" />
      <circle cx="5" cy="-22" r="2" fill="#3a2410" />
      <circle cx="-4.5" cy="-22.5" r="0.6" fill="#fff" />
      <circle cx="5.5" cy="-22.5" r="0.6" fill="#fff" />

      {/* Eyebrows depending on mood */}
      {mood === "happy" && (
        <>
          <path d="M -8 -27 L -3 -28" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M 3 -28 L 8 -27" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {mood === "worried" && (
        <>
          <path d="M -8 -26 L -3 -28" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M 3 -28 L 8 -26" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {mood === "sad" && (
        <>
          <path d="M -8 -29 L -3 -27" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M 3 -27 L 8 -29" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
      {mood === "shocked" && (
        <>
          <path d="M -8 -28 L -3 -28" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M 3 -28 L 8 -28" stroke="#3a2410" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}

      {/* Mouth */}
      <g transform="translate(0, -16)">
        <Mouth mood={mood} />
      </g>

      {/* Blush when happy */}
      {mood === "happy" && (
        <>
          <ellipse cx="-8" cy="-17" rx="2.5" ry="1.5" fill="#ed8688" opacity="0.55" />
          <ellipse cx="8" cy="-17" rx="2.5" ry="1.5" fill="#ed8688" opacity="0.55" />
        </>
      )}
    </g>
  );
}

export function MoneyBag({ size = 1, label }: { size?: number; label?: string }) {
  return (
    <motion.g animate={{ y: [0, -2, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}>
      <g transform={`scale(${size})`}>
        <ellipse cx="0" cy="20" rx="20" ry="3" fill="#000" opacity="0.15" />
        <path
          d="M -22 -6 Q -22 22 0 22 Q 22 22 22 -6 Q 18 -2 10 -2 L -10 -2 Q -18 -2 -22 -6 Z"
          fill="#c9aa56"
          stroke="#7a5d20"
          strokeWidth="1.2"
        />
        <path
          d="M -22 -6 Q -22 22 0 22 Q 22 22 22 -6"
          fill="url(#bagGrad)"
        />
        <path d="M -10 -2 L -8 -10 L 8 -10 L 10 -2 Z" fill="#a3853d" />
        <path d="M -8 -10 Q -2 -14 2 -14 Q 8 -14 8 -10" fill="none" stroke="#7a5d20" strokeWidth="1.4" />
        <text x="0" y="14" textAnchor="middle" fontSize="14" fontWeight="800" fill="#3a2410">$</text>
        {label && (
          <text x="0" y="34" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#3a2410">{label}</text>
        )}
        <defs>
          <linearGradient id="bagGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8c976" />
            <stop offset="100%" stopColor="#a3853d" />
          </linearGradient>
        </defs>
      </g>
    </motion.g>
  );
}
