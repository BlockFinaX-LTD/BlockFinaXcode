import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';
import hedgeImg from '@assets/brand/frame3_p2p_hedge.png';

const STATS = [
  { label: 'Asset Pairs', value: '63', color: '#4A90E2' },
  { label: 'Settlement', value: '5 min', color: '#F5A623' },
  { label: 'Status', value: 'HEDGED', color: '#22c55e' },
];

export const Scene3 = () => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 800),
      setTimeout(() => setPhase(2), 2400),
      setTimeout(() => setPhase(3), 4200),
      setTimeout(() => setPhase(4), 7200),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex overflow-hidden"
      style={{ background: '#050C1A' }}
      {...sceneTransitions.morphExpand}
    >
      <motion.div
        className="absolute inset-0"
        style={{ opacity: 0.35, mixBlendMode: 'screen' }}
        initial={{ opacity: 0 }}
        animate={phase >= 4 ? { opacity: 0, scale: 1.2 } : { opacity: 0.35, scale: 1 }}
        transition={{ duration: 1.5 }}
      >
        <img src={hedgeImg} alt="P2P Hedge" className="w-full h-full object-cover" />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, #050C1A 0%, transparent 40%, #050C1A 100%)' }}
        />
      </motion.div>

      <motion.div
        className="absolute"
        style={{
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          width: '55vh', height: '55vh',
        }}
        initial={{ scale: 0, rotate: -45, opacity: 0 }}
        animate={
          phase >= 4 ? { scale: 2, opacity: 0, filter: 'blur(20px)' } :
          phase >= 2 ? { scale: 1, rotate: 0, opacity: 1 } :
          { scale: 0, rotate: -45, opacity: 0 }
        }
        transition={{ type: 'spring', stiffness: 100, damping: 20 }}
      >
        <img
          src={hedgeImg}
          alt="Hedge Concept"
          className="w-full h-full object-cover rounded-full"
          style={{
            mixBlendMode: 'screen',
            opacity: 0.7,
            maskImage: 'radial-gradient(circle, black 30%, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(circle, black 30%, transparent 72%)',
          }}
        />
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ border: '1px solid rgba(74,144,226,0.6)' }}
          animate={phase >= 3 ? { scale: [1, 1.6], opacity: [0.8, 0] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </motion.div>

      <div className="relative z-10 w-full h-full flex flex-col items-center justify-between py-16 md:py-20">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: -30 }}
          animate={
            phase >= 4 ? { opacity: 0, y: -50 } :
            phase >= 1 ? { opacity: 1, y: 0 } :
            { opacity: 0, y: -30 }
          }
          transition={{ duration: 0.8, ease: 'circOut' }}
        >
          <div
            className="text-sm uppercase tracking-widest mb-4"
            style={{ color: '#4A90E2', fontFamily: 'monospace' }}
          >
            System Active
          </div>
          <h2
            className="font-bold"
            style={{
              fontSize: 'clamp(2.2rem, 6vw, 5rem)',
              color: '#ffffff',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Hedge. On-Chain.{' '}
            <span style={{ color: '#F5A623' }}>Instant.</span>
          </h2>
        </motion.div>

        <div className="flex gap-6 w-full max-w-3xl px-8">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              className="flex-1 backdrop-blur-md p-5 md:p-6 rounded-lg relative overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }}
              initial={{ opacity: 0, y: 50 }}
              animate={
                phase >= 4 ? { opacity: 0, y: 50 } :
                phase >= 2 ? { opacity: 1, y: 0 } :
                { opacity: 0, y: 50 }
              }
              transition={{ duration: 0.6, delay: i * 0.15, type: 'spring' }}
            >
              <motion.div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.04), transparent)', translateX: '-100%' }}
                animate={phase >= 3 ? { translateX: '200%' } : {}}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.4 }}
              />
              <div
                className="text-xs uppercase tracking-wider mb-2"
                style={{ color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}
              >
                {stat.label}
              </div>
              <div className="text-2xl md:text-3xl font-bold" style={{ color: stat.color, fontFamily: 'system-ui, sans-serif' }}>
                {stat.value}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};
