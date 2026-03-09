import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';
import closingImg from '@assets/brand/frame4_closing.png';

export const Scene4 = () => {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 700),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => setPhase(3), 5800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      style={{ background: '#050C1A' }}
      {...sceneTransitions.fadeBlur}
    >
      <motion.div
        className="absolute inset-0"
        initial={{ scale: 1.1, opacity: 0 }}
        animate={phase >= 3 ? { opacity: 0, scale: 1.2 } : { opacity: 0.65, scale: 1 }}
        transition={{ duration: 2, ease: 'easeOut' }}
        style={{ mixBlendMode: 'screen' }}
      >
        <img src={closingImg} alt="BlockFinaX" className="w-full h-full object-cover" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(circle at center, transparent 0%, rgba(5,12,26,0.75) 80%)' }}
        />
      </motion.div>

      <div className="relative z-10 text-center flex flex-col items-center">
        <motion.div
          className="relative mb-8"
          style={{ width: '6rem', height: '6rem' }}
          initial={{ scale: 0, rotate: 180 }}
          animate={
            phase >= 3 ? { scale: 0, opacity: 0 } :
            phase >= 1 ? { scale: 1, rotate: 0 } :
            { scale: 0, rotate: 180 }
          }
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          <div
            className="absolute inset-0 rotate-45 rounded-sm"
            style={{ border: '3px solid #4A90E2' }}
          />
          <div
            className="absolute inset-3 rounded-full"
            style={{ border: '2px solid #F5A623' }}
          />
          <div
            className="absolute"
            style={{
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#ffffff',
              fontWeight: 'bold',
              fontSize: '1.4rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            X
          </div>
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ background: 'rgba(74,144,226,0.2)', filter: 'blur(1.5rem)' }}
            animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        </motion.div>

        <motion.h1
          className="font-bold tracking-tighter mb-5"
          style={{
            fontSize: 'clamp(3.5rem, 10vw, 8rem)',
            color: '#ffffff',
            fontFamily: 'system-ui, sans-serif',
            filter: 'drop-shadow(0 0 30px rgba(74,144,226,0.5))',
          }}
          initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
          animate={
            phase >= 3 ? { opacity: 0, y: -20, filter: 'blur(10px)' } :
            phase >= 1 ? { opacity: 1, y: 0, filter: 'blur(0px) drop-shadow(0 0 30px rgba(74,144,226,0.5))' } :
            { opacity: 0, y: 20, filter: 'blur(10px)' }
          }
          transition={{ duration: 1, ease: 'circOut' }}
        >
          BLOCKFINAX
        </motion.h1>

        <motion.div
          className="flex flex-col items-center gap-3"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 0 } : phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="flex items-center gap-4">
            <div className="h-px w-14" style={{ background: 'rgba(74,144,226,0.5)' }} />
            <p
              className="text-lg md:text-xl uppercase tracking-widest"
              style={{ color: '#4A90E2', fontFamily: 'monospace' }}
            >
              Protect Your Margins
            </p>
            <div className="h-px w-14" style={{ background: 'rgba(74,144,226,0.5)' }} />
          </div>
          <p
            className="text-sm tracking-widest mt-1"
            style={{ color: 'rgba(245,166,35,0.7)', fontFamily: 'monospace' }}
          >
            Mainnet · July 7, 2026
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
};
