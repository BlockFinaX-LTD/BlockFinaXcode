/**
 * app-glyphs — coin / network / flag / commodity glyphs for the redesigned
 * signed-in app. Coin, network and flag SVGs are ported verbatim from the
 * design bundle (icons.js); commodities use lucide-react so they inherit the
 * same stroke treatment as the rest of the UI.
 *
 * Each glyph renders the raw SVG inside a `display:contents` wrapper so the
 * scoped CSS (`.coin svg`, `.mkt-fl svg`, …) sizes it exactly as the design.
 */
import { Coins, Droplet, Bean, Wheat, Circle } from 'lucide-react';

// ── coins (38×38) ──────────────────────────────────────────────────────
const COINS: Record<string, string> = {
  eth: '<svg viewBox="0 0 38 38" fill="none"><circle cx="19" cy="19" r="19" fill="#627EEA"/><path d="M19 6v9.6l8 3.6L19 6Z" fill="#fff" fill-opacity=".6"/><path d="M19 6l-8 13.2 8-3.6V6Z" fill="#fff"/><path d="M19 25.4V32l8-11.1-8 4.5Z" fill="#fff" fill-opacity=".6"/><path d="M19 32v-6.6l-8-4.5L19 32Z" fill="#fff"/><path d="M19 23.9l8-4.7-8-3.6v8.3Z" fill="#fff" fill-opacity=".2"/><path d="M11 19.2l8 4.7v-8.3l-8 3.6Z" fill="#fff" fill-opacity=".6"/></svg>',
  usdc: '<svg viewBox="0 0 38 38" fill="none"><circle cx="19" cy="19" r="19" fill="#2775CA"/><circle cx="19" cy="19" r="11.5" fill="none" stroke="#fff" stroke-width="1.8" opacity=".9"/><path d="M19 10.5v17" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/><path d="M22.6 14.6c-.9-1.4-2.3-2-3.9-2-2.1 0-3.5 1.1-3.5 2.8 0 1.8 1.5 2.4 3.7 3 2.2.6 3.8 1.3 3.8 3.2 0 1.8-1.5 2.9-3.7 2.9-1.8 0-3.4-.8-4.2-2.3" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  usdt: '<svg viewBox="0 0 38 38" fill="none"><circle cx="19" cy="19" r="19" fill="#26A17B"/><path d="M21.2 16.5v-2.3h5.3v-3.5H11.5v3.5h5.3v2.3c-4.3.2-7.5 1-7.5 2.1s3.2 1.9 7.5 2.1v7.3h4.4v-7.3c4.3-.2 7.5-1 7.5-2.1s-3.2-1.9-7.5-2.1Zm0 3.5v0c-.1 0-.7.1-2.1.1-1.1 0-1.9 0-2.2-.1v0c-3.6-.2-6.3-.8-6.3-1.5s2.7-1.3 6.3-1.5v2.4c.3 0 1.1.1 2.2.1 1.4 0 2-.1 2.1-.1v-2.4c3.6.2 6.3.8 6.3 1.5s-2.7 1.3-6.3 1.5Z" fill="#fff"/></svg>',
  wbtc: '<svg viewBox="0 0 38 38" fill="none"><circle cx="19" cy="19" r="19" fill="#F09242"/><circle cx="19" cy="19" r="13.5" fill="none" stroke="#fff" stroke-width="1.2" opacity=".5"/><path d="M22.4 17.1c.2-1.5-.9-2.3-2.5-2.8l.5-2.1-1.3-.3-.5 2-1-.3.5-2-1.3-.3-.5 2.1-2.1-.5-.3 1.4s.9.2.9.2c.5.1.6.5.6.7l-1.4 5.8c-.1.2-.2.4-.6.3 0 0-.9-.2-.9-.2l-.6 1.5 2 .5-.5 2.1 1.3.3.5-2.1 1 .3-.5 2.1 1.3.3.5-2.1c2.2.4 3.9.2 4.6-1.8.6-1.6 0-2.5-1.1-3.1.8-.2 1.5-.7 1.7-1.8Zm-3 4c-.4 1.6-3 .7-3.9.5l.7-2.8c.8.2 3.6.6 3.2 2.3Zm.4-4.1c-.3 1.5-2.5.7-3.2.6l.6-2.6c.7.2 3 .5 2.6 2Z" fill="#fff"/></svg>',
  gold: '<svg viewBox="0 0 38 38" fill="none"><circle cx="19" cy="19" r="19" fill="#C9A227"/><path d="M13 25l1.6-12h2.2l2.2 8 2.2-8h2.2L25 25h-2l-1-8-2 8h-2l-2-8-1 8h-2Z" fill="#fff" opacity=".95"/></svg>',
  bnb: '<svg viewBox="0 0 38 38" fill="none"><circle cx="19" cy="19" r="19" fill="#F3BA2F"/><path d="M19 9l3 3-5.9 5.9-3-3L19 9Zm6.9 6.9l3 3-9.9 9.9-3-3 9.9-9.9ZM12.1 15.9l3 3-3 3-3-3 3-3ZM19 22.8l3 3-3 3-3-3 3-3Z" fill="#fff"/></svg>',
};

// ── networks (24×24) ───────────────────────────────────────────────────
const NETS: Record<string, string> = {
  base: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#0052FF"/><path d="M12 19.5a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 7.4 6.4H9.2v2.2h10.2A7.5 7.5 0 0 1 12 19.5Z" fill="#fff"/></svg>',
  arb: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#2D374B"/><path d="M12 5l5 10-1.7 1L12 9.3 8.7 16 7 15l5-10Z" fill="#28A0F0"/><path d="M13.7 16l-1.2-2.5L11 16h2.7Z" fill="#fff"/></svg>',
  poly: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#8247E5"/><path d="M15.5 10.2c-.3-.2-.7-.2-1 0l-2 1.1-1.3.8-2 1.1c-.3.2-.7.2-1 0l-1.6-.9a1 1 0 0 1-.5-.8V9.7c0-.3.2-.6.5-.8l1.5-.8c.3-.2.7-.2 1 0l1.5.8c.3.2.5.5.5.8v1.1l1.3-.8V9c0-.3-.2-.6-.5-.8l-2.8-1.6c-.3-.2-.7-.2-1 0L5.5 8.2A1 1 0 0 0 5 9v3.2c0 .3.2.6.5.8l2.8 1.6c.3.2.7.2 1 0l2-1.1 1.3-.8 2-1.1c.3-.2.7-.2 1 0l1.5.8c.3.2.5.5.5.8v1.6c0 .3-.2.6-.5.8l-1.5.9c-.3.2-.7.2-1 0l-1.5-.8c-.3-.2-.5-.5-.5-.8v-1.1l-1.3.8v1.1c0 .3.2.6.5.8l2.8 1.6c.3.2.7.2 1 0l2.8-1.6c.3-.2.5-.5.5-.8V12c0-.3-.2-.6-.5-.8l-2.8-1Z" fill="#fff"/></svg>',
  eth_net: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#627EEA"/><path d="M12 4v6l5 2.2L12 4Z" fill="#fff" fill-opacity=".6"/><path d="M12 4L7 12.2 12 10V4Z" fill="#fff"/><path d="M12 16v4l5-7-5 3Z" fill="#fff" fill-opacity=".6"/><path d="M12 20v-4l-5-3 5 7Z" fill="#fff"/></svg>',
  bnb: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#F3BA2F"/><path d="M12 6l1.9 1.9L9.7 12 7.8 10.1 12 6Zm4.3 4.3L18.2 12l-6.2 6.2-1.9-1.9 6.2-6Zm-8.6 0L9.6 12l-1.9 1.9L5.8 12l1.9-1.7ZM12 13.9l1.9 1.9L12 17.7l-1.9-1.9L12 13.9Z" fill="#fff"/></svg>',
};

// ── circular country flags, keyed by currency code ─────────────────────
const FLAGS: Record<string, string> = {
  NGN: '<svg viewBox="0 0 24 24"><defs><clipPath id="fng"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fng)"><rect x="0" y="0" width="8" height="24" fill="#008751"/><rect x="8" y="0" width="8" height="24" fill="#fff"/><rect x="16" y="0" width="8" height="24" fill="#008751"/></g></svg>',
  GHS: '<svg viewBox="0 0 24 24"><defs><clipPath id="fgh"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fgh)"><rect x="0" y="0" width="24" height="8" fill="#ce1126"/><rect x="0" y="8" width="24" height="8" fill="#fcd116"/><rect x="0" y="16" width="24" height="8" fill="#006b3f"/><path d="M12 8.6l1.2 3.7h3.9l-3.1 2.3 1.2 3.7-3.1-2.3-3.1 2.3 1.2-3.7-3.1-2.3h3.9z" fill="#000"/></g></svg>',
  KES: '<svg viewBox="0 0 24 24"><defs><clipPath id="fke"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fke)"><rect x="0" y="0" width="24" height="7" fill="#000"/><rect x="0" y="7" width="24" height="1.4" fill="#fff"/><rect x="0" y="8.4" width="24" height="7.2" fill="#bb0000"/><rect x="0" y="15.6" width="24" height="1.4" fill="#fff"/><rect x="0" y="17" width="24" height="7" fill="#006600"/><ellipse cx="12" cy="12" rx="2.6" ry="5.2" fill="#bb0000" stroke="#fff" stroke-width="0.7"/><path d="M12 6.4v11.2" stroke="#000" stroke-width="0.8"/></g></svg>',
  EGP: '<svg viewBox="0 0 24 24"><defs><clipPath id="feg"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#feg)"><rect x="0" y="0" width="24" height="8" fill="#ce1126"/><rect x="0" y="8" width="24" height="8" fill="#fff"/><rect x="0" y="16" width="24" height="8" fill="#000"/><circle cx="12" cy="12" r="2.2" fill="#c09300"/></g></svg>',
  ZAR: '<svg viewBox="0 0 24 24"><defs><clipPath id="fza"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fza)"><rect x="0" y="0" width="24" height="24" fill="#fff"/><rect x="0" y="0" width="24" height="8" fill="#e03c31"/><rect x="0" y="16" width="24" height="8" fill="#001489"/><path d="M0 0l10 12L0 24z" fill="#007749"/><path d="M0 2l8 10-8 10z" fill="#ffb612"/><path d="M0 4l6.5 8L0 20z" fill="#000"/></g></svg>',
  XOF: '<svg viewBox="0 0 24 24"><defs><clipPath id="fxo"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fxo)"><rect x="0" y="0" width="8" height="24" fill="#009e60"/><rect x="8" y="0" width="8" height="24" fill="#fcd116"/><rect x="16" y="0" width="8" height="24" fill="#ce1126"/></g></svg>',
  TZS: '<svg viewBox="0 0 24 24"><defs><clipPath id="ftz"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#ftz)"><polygon points="0,0 24,0 0,24" fill="#1eb53a"/><polygon points="24,0 24,24 0,24" fill="#00a3dd"/><line x1="24" y1="0" x2="0" y2="24" stroke="#fcd116" stroke-width="4.5"/><line x1="24" y1="0" x2="0" y2="24" stroke="#000" stroke-width="2"/></g></svg>',
  ETB: '<svg viewBox="0 0 24 24"><defs><clipPath id="fet"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fet)"><rect x="0" y="0" width="24" height="8" fill="#078930"/><rect x="0" y="8" width="24" height="8" fill="#fcdd09"/><rect x="0" y="16" width="24" height="8" fill="#da121a"/><circle cx="12" cy="12" r="4.5" fill="#0f47af"/><path d="M12 8.6l0.9 2.7h2.9l-2.3 1.7 0.9 2.7-2.3-1.7-2.3 1.7 0.9-2.7-2.3-1.7h2.9z" fill="#fcdd09"/></g></svg>',
  UGX: '<svg viewBox="0 0 24 24"><defs><clipPath id="fug"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fug)"><rect x="0" y="0" width="24" height="4" fill="#000"/><rect x="0" y="4" width="24" height="4" fill="#fcdc04"/><rect x="0" y="8" width="24" height="4" fill="#d90000"/><rect x="0" y="12" width="24" height="4" fill="#000"/><rect x="0" y="16" width="24" height="4" fill="#fcdc04"/><rect x="0" y="20" width="24" height="4" fill="#d90000"/><circle cx="12" cy="12" r="3.2" fill="#fff"/></g></svg>',
};

// Fallback generic coin: tinted circle with the symbol's first letters.
function fallbackCoin(label: string): string {
  const t = (label || '?').slice(0, 3).toUpperCase();
  return `<svg viewBox="0 0 38 38" fill="none"><circle cx="19" cy="19" r="19" fill="#2d6cff" opacity="0.18"/><text x="19" y="23" text-anchor="middle" font-family="Geist Mono, monospace" font-size="11" font-weight="600" fill="#2d6cff">${t}</text></svg>`;
}

function fallbackFlag(code: string): string {
  const t = (code || '?').slice(0, 3).toUpperCase();
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#262626"/><text x="12" y="15" text-anchor="middle" font-family="Geist Mono, monospace" font-size="7.5" font-weight="600" fill="#b5b5b5">${t}</text></svg>`;
}

function Raw({ html }: { html: string }) {
  // display:contents keeps the wrapper out of the box model so scoped
  // `.coin svg`, `.mkt-fl svg` rules size the inner SVG directly.
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Map a token symbol (USDC, ETH, …) to a coin glyph key. */
export function coinKeyForSymbol(symbol?: string): string {
  const s = (symbol || '').toUpperCase();
  if (s === 'USDC') return 'usdc';
  if (s === 'USDT') return 'usdt';
  if (s === 'ETH' || s === 'WETH') return 'eth';
  if (s === 'WBTC' || s === 'BTC') return 'wbtc';
  if (s === 'BNB') return 'bnb';
  if (s === 'XAUT' || s === 'XAU' || s === 'GOLD') return 'gold';
  return '';
}

/** Map a chain name (BASE, BNB, …) to a network glyph key. */
export function netKeyForChain(chain?: string): string {
  const c = (chain || '').toUpperCase();
  if (c === 'BASE') return 'base';
  if (c === 'ARBITRUM' || c === 'ARB') return 'arb';
  if (c === 'POLYGON' || c === 'POLY' || c === 'MATIC') return 'poly';
  if (c === 'ETHEREUM' || c === 'ETH') return 'eth_net';
  if (c === 'BNB' || c === 'BSC' || c === 'BINANCE') return 'bnb';
  return '';
}

export function CoinSvg({ token, label }: { token: string; label?: string }) {
  return <Raw html={COINS[token] || fallbackCoin(label || token)} />;
}

export function NetSvg({ net }: { net: string }) {
  const html = NETS[net];
  if (!html) return null;
  return <Raw html={html} />;
}

export function FlagSvg({ code }: { code: string }) {
  return <Raw html={FLAGS[code] || fallbackFlag(code)} />;
}

const COMMODITY_LUCIDE: Record<string, typeof Coins> = {
  gold: Coins,
  oil: Droplet,
  cocoa: Bean,
  wheat: Wheat,
};

export function CommoditySvg({ ic }: { ic?: string }) {
  const Icon = (ic && COMMODITY_LUCIDE[ic]) || Circle;
  return <Icon />;
}

/** Currency codes we have a real flag for (used to decide flag vs fallback). */
export const KNOWN_FLAGS = Object.keys(FLAGS);
