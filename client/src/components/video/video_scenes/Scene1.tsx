import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { elementAnimations, charVariants, staggerConfigs, sceneTransitions } from '@/lib/video';

export const Scene1 = () => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 1200),
      setTimeout(() => setPhase(2), 2600),
      setTimeout(() => setPhase(3), 5400),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const title = 'BLOCKFINAX';
  const subtitle = 'PROTECT';

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ background: '#050C1A' }}
      {...sceneTransitions.fadeBlur}
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(74,144,226,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(74,144,226,0.08) 1px, transparent 1px)',
          backgroundSize: '4rem 4rem',
          maskImage: 'radial-gradient(ellipse 65% 65% at 50% 50%, #000 10%, transparent 100%)',
        }}
      />

      <motion.div
        className="absolute rounded-full"
        style={{ width: '42vw', height: '42vw', background: 'rgba(74,144,226,0.18)', filter: 'blur(90px)' }}
        animate={{
          scale: phase >= 3 ? 1.6 : [1, 1.18, 1],
          opacity: phase >= 3 ? 0 : [0.5, 0.85, 0.5],
        }}
        transition={{ duration: 4, repeat: phase < 3 ? Infinity : 0, ease: 'easeInOut' }}
      />

      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          className="flex overflow-hidden"
          initial="hidden"
          animate={phase >= 3 ? { y: -55, opacity: 0, filter: 'blur(10px)' } : 'visible'}
          variants={{ visible: { transition: staggerConfigs.slow } }}
          transition={{ duration: 0.8, ease: 'circOut' }}
        >
          {title.split('').map((char, i) => (
            <motion.span
              key={i}
              className="font-bold tracking-tighter"
              style={{
                fontSize: 'clamp(3rem, 8vw, 7rem)',
                color: '#ffffff',
                fontFamily: 'system-ui, sans-serif',
              }}
              variants={charVariants}
            >
              {char}
            </motion.span>
          ))}
        </motion.div>

        <motion.div
          className="flex overflow-hidden"
          style={{ marginTop: '-0.5rem' }}
          initial="hidden"
          animate={phase >= 3 ? { y: -35, opacity: 0, filter: 'blur(10px)' } : 'visible'}
          variants={{ visible: { transition: { ...staggerConfigs.slow, delayChildren: 0.5 } } }}
          transition={{ duration: 0.8, ease: 'circOut', delay: 0.1 }}
        >
          {subtitle.split('').map((char, i) => (
            <motion.span
              key={i}
              className="font-light tracking-widest"
              style={{
                fontSize: 'clamp(2rem, 5.5vw, 4.5rem)',
                color: '#4A90E2',
                fontFamily: 'system-ui, sans-serif',
              }}
              variants={{
                hidden: { opacity: 0, y: 40 },
                visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 280, damping: 22 } },
              }}
            >
              {char}
            </motion.span>
          ))}
        </motion.div>

        <motion.div
          className="mt-8 px-6 py-2 rounded-full backdrop-blur-sm"
          style={{ border: '1px solid rgba(74,144,226,0.35)', background: 'rgba(74,144,226,0.08)' }}
          initial={{ opacity: 0, scale: 0.8, y: 20 }}
          animate={
            phase >= 3 ? { opacity: 0, y: 20 } :
            phase >= 2 ? { opacity: 1, scale: 1, y: 0 } :
            { opacity: 0, scale: 0.8, y: 20 }
          }
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <span
            className="text-sm uppercase tracking-widest"
            style={{ color: '#4A90E2', fontFamily: 'monospace' }}
          >
            P2P Parametric Protection · 63 Pairs
          </span>
        </motion.div>
      </div>

      {[
        { top: '2rem', left: '2rem', borderTop: true, borderLeft: true, delay: 1.0 },
        { top: '2rem', right: '2rem', borderTop: true, borderRight: true, delay: 1.2 },
        { bottom: '2rem', left: '2rem', borderBottom: true, borderLeft: true, delay: 1.4 },
        { bottom: '2rem', right: '2rem', borderBottom: true, borderRight: true, delay: 1.6 },
      ].map((corner, i) => (
        <motion.div
          key={i}
          className="absolute w-8 h-8"
          style={{
            top: corner.top,
            left: corner.left,
            right: corner.right,
            bottom: corner.bottom,
            borderTop: corner.borderTop ? '2px solid rgba(74,144,226,0.55)' : undefined,
            borderBottom: corner.borderBottom ? '2px solid rgba(74,144,226,0.55)' : undefined,
            borderLeft: corner.borderLeft ? '2px solid rgba(74,144,226,0.55)' : undefined,
            borderRight: corner.borderRight ? '2px solid rgba(74,144,226,0.55)' : undefined,
          }}
          {...elementAnimations.popIn}
          transition={{ delay: corner.delay }}
        />
      ))}
    </motion.div>
  );
};
