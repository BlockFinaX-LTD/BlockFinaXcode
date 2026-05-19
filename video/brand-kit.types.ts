export type ToneTag =
  | "confident"
  | "playful"
  | "authoritative"
  | "warm"
  | "edgy"
  | "professional"
  | "quirky";

export type Platform =
  | "tiktok"
  | "instagram-reels"
  | "instagram-feed"
  | "youtube-shorts"
  | "youtube"
  | "linkedin"
  | "twitter"
  | "custom";

export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5" | "4:3";

export type FontSource = "google" | "local" | "url" | "system";

export type FontDef = {
  family: string;
  weights: number[];
  fallback: string;
  source: FontSource;
  url?: string;
};

export type SceneRole =
  | "hook"
  | "problem"
  | "solution"
  | "proof"
  | "cta"
  | "custom";

export type Scene = {
  id: string;
  role: SceneRole;
  durationInSeconds: number;
  text: string;
  voiceover?: string;
  bRoll?: string[];
  notes?: string;
};

export type BrandKit = {
  brand: {
    name: string;
    tagline?: string;
    tone: ToneTag[];
    audience: {
      primary: string;
      segments?: string[];
    };
    language: string;
  };
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    foreground: string;
    muted?: string;
    extra?: Record<string, string>;
  };
  typography: {
    heading: FontDef;
    body: FontDef;
    mono?: FontDef;
  };
  logo: {
    light: string;
    dark: string;
    mark?: string;
    safeZone: number;
    minHeight: number;
  } | null;
  video: {
    platform: Platform;
    aspectRatio: AspectRatio;
    width: number;
    height: number;
    fps: number;
    durationInSeconds: number;
  };
  content: {
    headline: string;
    subheadline?: string;
    cta: {
      text: string;
      url?: string;
    };
    script?: string;
    scenes: Scene[];
  };
  audio: {
    music?: {
      source: "url" | "local" | "none";
      path?: string;
      mood?: string;
      bpm?: number;
      volume?: number;
    };
    sfx?: Array<{
      event: string;
      path: string;
    }>;
    voiceover?: {
      provider?: "elevenlabs" | "openai" | "manual";
      voiceId?: string;
      locale?: string;
    };
  };
  meta: {
    createdAt: string;
    version: string;
  };
};
