/**
 * Shareable position card, drawn on a canvas so it can be saved or shared as an image.
 */
import QRCode from 'qrcode';
import logoPath from '@/assets/logo-mark.png';
import { pairLabel } from '@shared/market-pairs';

export interface ShareInput { pair: string; size: number; entry: number; mark: number; upnl: number; roe: number }

const px = (v: number, dp: number) => v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const signed = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctS = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;

const SHARE_W = 1080, SHARE_H = 1350;
const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

/** Draws a position card as an image: pair, side, leverage, ROE (and PnL if shown), entry and mark. */
export async function drawShareCard(c: HTMLCanvasElement, p: ShareInput, lev: string | null, dp: number, showAmount: boolean) {
  const g = c.getContext('2d'); if (!g) return;
  c.width = SHARE_W; c.height = SHARE_H;
  await document.fonts?.ready;
  const sans = 'Geist, system-ui, -apple-system, Segoe UI, sans-serif', mono = "'Geist Mono', ui-monospace, monospace";
  const long = p.size > 0, up = p.upnl >= 0;
  const green = '#3cbf7f', red = '#ee6a7e', muted = '#8d97a8', text = '#e8edf5';

  const bg = g.createLinearGradient(0, 0, SHARE_W, SHARE_H);
  bg.addColorStop(0, '#0b1530'); bg.addColorStop(1, '#091022');
  g.fillStyle = bg; g.fillRect(0, 0, SHARE_W, SHARE_H);

  const logo = await loadImg(logoPath).catch(() => null);
  if (logo) { g.globalAlpha = 0.07; g.drawImage(logo, 520, 140, 720, 720); g.globalAlpha = 1; }

  // Brand and time
  if (logo) g.drawImage(logo, 80, 84, 76, 76);
  g.fillStyle = text; g.font = `700 46px ${sans}`; g.textBaseline = 'middle';
  g.fillText('BlockFinaX', 176, 112);
  g.fillStyle = muted; g.font = `400 30px ${mono}`;
  g.fillText(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, 176, 152);

  // Market and side
  g.fillStyle = text; g.font = `700 78px ${sans}`;
  g.fillText(`${pairLabel(p.pair)} Perpetual`, 80, 420);
  g.font = `500 44px ${sans}`;
  g.fillStyle = long ? green : red; g.fillText(long ? 'Long' : 'Short', 80, 500);
  const w = g.measureText(long ? 'Long' : 'Short').width;
  if (lev) { g.fillStyle = muted; g.fillText(`|   ${lev}`, 80 + w + 28, 500); }

  // Result
  g.fillStyle = up ? green : red; g.font = `700 168px ${mono}`;
  g.fillText(pctS(p.roe), 72, 660);
  if (showAmount) { g.font = `600 52px ${mono}`; g.fillText(`${signed(p.upnl)} USD`, 80, 780); }

  // Prices
  const y = showAmount ? 930 : 860;
  g.fillStyle = muted; g.font = `400 36px ${sans}`;
  g.fillText('Entry price', 80, y); g.fillText('Mark price', 560, y);
  g.fillStyle = text; g.font = `600 52px ${mono}`;
  g.fillText(px(p.entry, dp), 80, y + 66); g.fillText(px(p.mark, dp), 560, y + 66);

  // Footer
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 1130, SHARE_W, 2);
  g.fillStyle = text; g.font = `600 40px ${sans}`;
  g.fillText('Hedge and trade exotic currencies', 80, 1200);
  g.fillStyle = muted; g.font = `400 34px ${sans}`;
  g.fillText('blockfinax.com', 80, 1256);
  const qr = await QRCode.toDataURL('https://blockfinax.com', { margin: 1, width: 168, color: { dark: '#091022', light: '#ffffff' } }).catch(() => null);
  if (qr) {
    const q = await loadImg(qr).catch(() => null);
    if (q) { g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(SHARE_W - 80 - 184, 1150, 184, 184, 16); g.fill(); g.drawImage(q, SHARE_W - 80 - 176, 1158, 168, 168); }
  }
}

