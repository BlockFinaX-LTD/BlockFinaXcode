import type { BrandKit } from "./brand-kit.types";
import data from "./brand-kit.json";

export const brandKit: BrandKit = data as BrandKit;

export const durationInFrames = Math.round(
  brandKit.video.durationInSeconds * brandKit.video.fps,
);

export const sceneFrames = brandKit.content.scenes.map((scene) => ({
  id: scene.id,
  frames: Math.round(scene.durationInSeconds * brandKit.video.fps),
}));
