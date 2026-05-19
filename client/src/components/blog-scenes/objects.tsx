import { motion } from "framer-motion";

const SERIF = "Georgia, 'Times New Roman', serif";

interface BanknoteProps {
  amount: string;
  scale?: number;
  /** "green" looks like USD, "navy" is a brand-colored variant */
  variant?: "green" | "navy";
}

export function Banknote({ amount, scale = 1, variant = "green" }: BanknoteProps) {
  const c =
    variant === "green"
      ? { body: "#b9d8b3", border: "#3a6b3a", oval: "#e1efdd", text: "#1a3a1a", corner: "#3a6b3a", detail: "#65945e" }
      : { body: "#c8d8ee", border: "#1a4480", oval: "#e8effa", text: "#0f2744", corner: "#1a4480", detail: "#6a8bc4" };

  return (
    <g transform={`scale(${scale})`}>
      <ellipse cx="2" cy="20" rx="34" ry="2.5" fill="#000" opacity="0.15" />
      {/* Bill body */}
      <rect x="-34" y="-18" width="68" height="36" rx="2.5" fill={c.body} stroke={c.border} strokeWidth="1.2" />
      {/* Inner border */}
      <rect x="-30" y="-14" width="60" height="28" rx="1.5" fill="none" stroke={c.border} strokeWidth="0.6" opacity="0.6" />
      {/* Detail ornaments */}
      <line x1="-30" y1="0" x2="-18" y2="0" stroke={c.detail} strokeWidth="0.4" opacity="0.5" />
      <line x1="18" y1="0" x2="30" y2="0" stroke={c.detail} strokeWidth="0.4" opacity="0.5" />
      {/* Center oval */}
      <ellipse cx="0" cy="0" rx="15" ry="9.5" fill={c.oval} stroke={c.border} strokeWidth="0.8" />
      {/* Amount */}
      <text
        x="0"
        y="3.5"
        textAnchor="middle"
        fontSize="10"
        fontWeight="800"
        fill={c.text}
        style={{ fontFamily: SERIF }}
      >
        {amount}
      </text>
      {/* Corner amounts */}
      <text x="-28" y="-7" fontSize="6.5" fontWeight="800" fill={c.corner} style={{ fontFamily: SERIF }}>
        {amount}
      </text>
      <text x="28" y="-7" textAnchor="end" fontSize="6.5" fontWeight="800" fill={c.corner} style={{ fontFamily: SERIF }}>
        {amount}
      </text>
      <text x="-28" y="15" fontSize="6.5" fontWeight="800" fill={c.corner} style={{ fontFamily: SERIF }}>
        {amount}
      </text>
      <text x="28" y="15" textAnchor="end" fontSize="6.5" fontWeight="800" fill={c.corner} style={{ fontFamily: SERIF }}>
        {amount}
      </text>
    </g>
  );
}

interface CashStackProps {
  amount: string;
  count?: number;
  scale?: number;
}

/** A stack of N banknotes fanned slightly. */
export function CashStack({ amount, count = 4, scale = 1 }: CashStackProps) {
  return (
    <g transform={`scale(${scale})`}>
      {Array.from({ length: count }).map((_, i) => (
        <g key={i} transform={`translate(${i * 1.5}, ${-i * 1.8}) rotate(${(i - count / 2) * 2})`}>
          <Banknote amount={amount} />
        </g>
      ))}
    </g>
  );
}

interface UmbrellaProps {
  scale?: number;
}

export function Umbrella({ scale = 1 }: UmbrellaProps) {
  return (
    <g transform={`scale(${scale})`}>
      {/* Dome shape */}
      <path d="M -42 0 Q -42 -36 0 -36 Q 42 -36 42 0 Z" fill="#1a4480" />
      {/* Vertical segment dividers, alternating shades */}
      <path d="M -42 0 Q -34 -32 -22 -36 L -22 0 Z" fill="#0f2744" opacity="0.35" />
      <path d="M -22 0 L -22 -36 Q -16 -36 -7 -36 L -7 0 Z" fill="#4a90e2" opacity="0.18" />
      <path d="M -7 0 L -7 -36 Q -3 -36 0 -36 Q 3 -36 7 -36 L 7 0 Z" fill="#0f2744" opacity="0.25" />
      <path d="M 7 0 L 7 -36 Q 16 -36 22 -36 L 22 0 Z" fill="#4a90e2" opacity="0.18" />
      <path d="M 22 0 L 22 -36 Q 34 -32 42 0 Z" fill="#0f2744" opacity="0.35" />
      {/* Rim scallops for cartoonish edge */}
      <path d="M -42 0 Q -38 -3 -34 0 Q -30 -3 -22 0 Q -14 -3 -7 0 Q 0 -3 7 0 Q 14 -3 22 0 Q 30 -3 34 0 Q 38 -3 42 0 L 42 2 Q 38 -1 34 2 Q 30 -1 22 2 Q 14 -1 7 2 Q 0 -1 -7 2 Q -14 -1 -22 2 Q -30 -1 -34 2 Q -38 -1 -42 2 Z" fill="#1a4480" />
      {/* Top finial */}
      <rect x="-1" y="-42" width="2" height="8" fill="#1a4480" />
      <circle cx="0" cy="-42" r="2" fill="#1a4480" />
      {/* Handle (J-shape) */}
      <path
        d="M 0 0 L 0 44 Q 0 52 7 52 L 13 52 Q 16 52 16 48"
        stroke="#7c5028"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

interface FloatingNumberProps {
  text: string;
  /** Color hex for the text */
  color: string;
  fontSize?: number;
  startDelay: number;
  startY?: number;
  endY?: number;
  duration?: number;
  trigger: boolean;
}

/** A floating "damage number" or "payout" that rises from a point and fades. */
export function FloatingNumber({ text, color, fontSize = 18, startDelay, startY = 0, endY = -55, duration = 1.8, trigger }: FloatingNumberProps) {
  return (
    <motion.g
      initial={{ opacity: 0, y: startY, scale: 0.5 }}
      animate={trigger ? { opacity: [0, 1, 1, 0], y: [startY, startY - 15, endY + 10, endY], scale: [0.5, 1.15, 1, 0.85] } : {}}
      transition={{
        delay: startDelay,
        duration,
        times: [0, 0.18, 0.7, 1],
        ease: "easeOut",
      }}
    >
      <text
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="900"
        fill={color}
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          paintOrder: "stroke",
          stroke: "#fff",
          strokeWidth: 3,
          strokeLinejoin: "round",
        }}
      >
        {text}
      </text>
    </motion.g>
  );
}
