import { AnimatePresence } from 'framer-motion';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';

const SCENE_DURATIONS = {
  intro: 6000,
  problem: 6000,
  solution: 8000,
  outro: 7000,
};

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div
      className="w-full overflow-hidden relative"
      style={{ backgroundColor: '#050C1A', aspectRatio: '16 / 9', height: '100vh' }}
    >
      <div style={{ position: 'absolute', top: '16px', left: '16px', zIndex: 50 }}>
        <Link href="/">
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '6px 12px', borderRadius: '6px', fontSize: '13px',
            background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
          }}>
            <ArrowLeft style={{ width: '14px', height: '14px' }} />
            Home
          </button>
        </Link>
      </div>
      <AnimatePresence mode="wait">
        {currentScene === 0 && <Scene1 key="intro" />}
        {currentScene === 1 && <Scene2 key="problem" />}
        {currentScene === 2 && <Scene3 key="solution" />}
        {currentScene === 3 && <Scene4 key="outro" />}
      </AnimatePresence>
    </div>
  );
}
