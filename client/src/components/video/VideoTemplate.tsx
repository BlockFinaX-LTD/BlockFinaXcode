import { AnimatePresence } from 'framer-motion';
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
      <AnimatePresence mode="wait">
        {currentScene === 0 && <Scene1 key="intro" />}
        {currentScene === 1 && <Scene2 key="problem" />}
        {currentScene === 2 && <Scene3 key="solution" />}
        {currentScene === 3 && <Scene4 key="outro" />}
      </AnimatePresence>
    </div>
  );
}
