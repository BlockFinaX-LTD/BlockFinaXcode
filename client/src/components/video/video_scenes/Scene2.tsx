import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';
import africaImg from '@assets/brand/frame2_africa_protection.png';

const FX_TICKERS = [
  'USD/GHS', 'EUR/NGN', 'USD/KES', 'GBP/XOF', 'USD/ZAR',
  'USD/TZS', 'EUR/GHS', 'USD/ETB', 'GBP/NGN', 'USD/UGX',
];

export const Scene2 = () => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 900),
      setTimeout(() => setPhase(2), 2400),
      setTimeout(() => setPhase(3), 5300),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex overflow-hidden"
      style={{ background: '#050C1A' }}
      {...sceneTransitions.clipPolygon}
    >
      <motion.div
        className="absolute inset-0"
        style={{ width: '120%', height: '120%', left: '-10%', top: '-10%' }}
        initial={{ scale: 1.2 }}
        animate={phase >= 3 ? { scale: 1.5, filter: 'blur(20px)', opacity: 0 } : { scale: 1 }}
        transition={{ duration: 5, ease: 'easeOut' }}
      >
        <img
          src={africaImg}
          alt="Africa Protection Network"
          className="w-full h-full object-cover"
          style={{ opacity: 0.5, mixBlendMode: 'screen' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, #050C1A 0%, rgba(5,12,26,0.75) 50%, transparent 100%)' }}
        />
      </motion.div>

      <div className="relative z-10 flex flex-col justify-center px-16 md:px-24 w-full md:w-2/3">
        <motion.div
          className="mb-6 overflow-hidden"
          initial={{ opacity: 0, x: -50 }}
          animate={phase >= 3 ? { opacity: 0, x: -50 } : phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
          transition={{ duration: 0.8, ease: 'circOut' }}
        >
          <div className="flex items-center gap-4">
            <div className="h-px w-12" style={{ background: '#ef4444' }} />
            <span
              className="uppercase text-sm font-bold tracking-widest"
              style={{ color: '#ef4444', fontFamily: 'monospace' }}
            >
              Market Reality
            </span>
          </div>
        </motion.div>

        <motion.h2
          className="font-bold leading-tight"
          style={{ fontSize: 'clamp(2.5rem, 7vw, 6rem)', color: '#ffffff', fontFamily: 'system-ui, sans-serif', lineHeight: 1.1 }}
          initial={{ opacity: 0, y: 40 }}
          animate={phase >= 3 ? { opacity: 0, y: -40 } : phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        >
          FX Volatility{' '}
          <br />
          <motion.span
            style={{
              background: 'linear-gradient(90deg, #ef4444, #f97316)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              display: 'inline-block',
            }}
            animate={
              phase === 2 ? { x: [-2, 2, -2, 2, 0], filter: ['blur(2px)', 'blur(0px)'] } : {}
            }
            transition={{ duration: 0.3 }}
          >
            Wipes Margins.
          </motion.span>
        </motion.h2>

        <motion.p
          className="mt-8 text-lg md:text-xl pl-6"
          style={{
            color: 'rgba(255,255,255,0.6)',
            fontFamily: 'monospace',
            borderLeft: '2px solid rgba(255,255,255,0.2)',
            maxWidth: '32rem',
          }}
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={
            phase >= 3 ? { opacity: 0, filter: 'blur(10px)' } :
            phase >= 2 ? { opacity: 1, filter: 'blur(0px)' } :
            { opacity: 0, filter: 'blur(10px)' }
          }
          transition={{ duration: 1 }}
        >
          African businesses lose 15–40% on unprotected cross-border payments. There was no hedge.
        </motion.p>
      </div>

      <motion.div
        className="absolute right-10 top-1/4 bottom-1/4 flex flex-col justify-between"
        style={{ width: '14rem' }}
        initial={{ opacity: 0, x: 50 }}
        animate={phase >= 1 ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 1, delay: 0.5 }}
      >
        {FX_TICKERS.slice(0, 8).map((pair, i) => (
          <motion.div
            key={pair}
            className="text-right text-xs"
            style={{ color: 'rgba(239,68,68,0.45)', fontFamily: 'monospace' }}
            animate={{ opacity: [0.25, 0.75, 0.25], x: [0, -8, 0] }}
            transition={{ duration: 2 + i * 0.3, repeat: Infinity, delay: i * 0.18 }}
          >
            {pair} : -{(Math.random() * 3 + 0.5).toFixed(2)}%
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
};
