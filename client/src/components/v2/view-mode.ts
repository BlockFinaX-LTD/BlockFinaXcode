/**
 * Simple or Advanced, for the whole workspace. Simple is for businesses: buy cover, my cover,
 * rates and wallet, with everything else out of sight. Advanced is the full workspace,
 * underwriting and the trading screen included. Remembered per viewer; every part of the
 * page that reads it updates together.
 */
import { useEffect, useState } from 'react';

export type ViewMode = 'simple' | 'advanced';
const KEY = 'bfx:view';
const EVENT = 'bfx:view-change';

function read(): ViewMode {
  try {
    const v = localStorage.getItem(KEY) ?? localStorage.getItem('bfx:markets-view');
    return v === 'advanced' ? 'advanced' : 'simple';
  } catch { return 'simple'; }
}

export function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(read);
  useEffect(() => {
    const sync = () => setMode(read());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const choose = (v: ViewMode) => {
    try { localStorage.setItem(KEY, v); } catch { /* per-viewer convenience */ }
    setMode(v);
    window.dispatchEvent(new Event(EVENT));
  };
  return [mode, choose];
}
