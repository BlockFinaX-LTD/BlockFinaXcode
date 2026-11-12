import { motion } from "framer-motion";

type Mood = "happy" | "worried" | "sad" | "shocked";

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
      {/* Shadow — stationary, not part of breathing motion */}
      <ellipse cx="0" cy="58" rx="22" ry="4" fill="#000" opacity="0.12" />
      <motion.g
        animate={{ y: [0, -1.2, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      >

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
      </motion.g>
    </g>
  );
}
