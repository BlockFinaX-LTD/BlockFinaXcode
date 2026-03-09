/**
 * Video Player Hook - Controls multi-scene video playback timing
 *
 * Manages which scene is currently visible in an animated video presentation
 * by auto-advancing through scenes based on their configured durations.
 * Used by the VideoTemplate component on the /video page.
 * Exports: useVideoPlayer
 */
import { useState, useEffect } from 'react';

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);
  const keys = Object.keys(durations);

  useEffect(() => {
    let accumulated = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    keys.forEach((_, index) => {
      if (index === 0) return;
      accumulated += durations[keys[index - 1]];
      const t = setTimeout(() => setCurrentScene(index), accumulated);
      timers.push(t);
    });

    return () => timers.forEach(clearTimeout);
  }, []);

  return { currentScene };
}

export const sceneTransitions = {
  fadeBlur: {
    initial: { opacity: 0, filter: 'blur(12px)' },
    animate: { opacity: 1, filter: 'blur(0px)', transition: { duration: 0.9, ease: 'easeOut' } },
    exit: { opacity: 0, filter: 'blur(12px)', transition: { duration: 0.7, ease: 'easeIn' } },
  },
  clipPolygon: {
    initial: { opacity: 0, x: 80 },
    animate: { opacity: 1, x: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, x: -80, transition: { duration: 0.6, ease: 'easeIn' } },
  },
  morphExpand: {
    initial: { opacity: 0, scale: 0.92 },
    animate: { opacity: 1, scale: 1, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] } },
    exit: { opacity: 0, scale: 1.06, transition: { duration: 0.7, ease: 'easeIn' } },
  },
};

export const charVariants = {
  hidden: { opacity: 0, y: 60 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 22 },
  },
};

export const staggerConfigs = {
  slow: { staggerChildren: 0.07, delayChildren: 0.2 },
  fast: { staggerChildren: 0.04, delayChildren: 0.1 },
};

export const elementAnimations = {
  popIn: {
    initial: { opacity: 0, scale: 0 },
    animate: { opacity: 1, scale: 1, transition: { type: 'spring' as const, stiffness: 300, damping: 20 } },
  },
};
