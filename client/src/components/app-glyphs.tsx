

// ── circular country flags, keyed by currency code ─────────────────────
const FLAGS: Record<string, string> = {
  NGN: '<svg viewBox="0 0 24 24"><defs><clipPath id="fng"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fng)"><rect x="0" y="0" width="8" height="24" fill="#008751"/><rect x="8" y="0" width="8" height="24" fill="#fff"/><rect x="16" y="0" width="8" height="24" fill="#008751"/></g></svg>',
  TRY: '<svg viewBox="0 0 24 24"><defs><clipPath id="ftr"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#ftr)"><rect x="0" y="0" width="24" height="24" fill="#e30a17"/><circle cx="9.6" cy="12" r="4.6" fill="#fff"/><circle cx="11.3" cy="12" r="3.7" fill="#e30a17"/><path d="M15.6 9.9l.72 2.04 2.16.03-1.73 1.29.64 2.07-1.79-1.23-1.79 1.23.64-2.07-1.73-1.29 2.16-.03z" fill="#fff"/></g></svg>',
  GHS: '<svg viewBox="0 0 24 24"><defs><clipPath id="fgh"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fgh)"><rect x="0" y="0" width="24" height="8" fill="#ce1126"/><rect x="0" y="8" width="24" height="8" fill="#fcd116"/><rect x="0" y="16" width="24" height="8" fill="#006b3f"/><path d="M12 8.6l1.2 3.7h3.9l-3.1 2.3 1.2 3.7-3.1-2.3-3.1 2.3 1.2-3.7-3.1-2.3h3.9z" fill="#000"/></g></svg>',
  KES: '<svg viewBox="0 0 24 24"><defs><clipPath id="fke"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fke)"><rect x="0" y="0" width="24" height="7" fill="#000"/><rect x="0" y="7" width="24" height="1.4" fill="#fff"/><rect x="0" y="8.4" width="24" height="7.2" fill="#bb0000"/><rect x="0" y="15.6" width="24" height="1.4" fill="#fff"/><rect x="0" y="17" width="24" height="7" fill="#006600"/><ellipse cx="12" cy="12" rx="2.6" ry="5.2" fill="#bb0000" stroke="#fff" stroke-width="0.7"/><path d="M12 6.4v11.2" stroke="#000" stroke-width="0.8"/></g></svg>',
  EGP: '<svg viewBox="0 0 24 24"><defs><clipPath id="feg"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#feg)"><rect x="0" y="0" width="24" height="8" fill="#ce1126"/><rect x="0" y="8" width="24" height="8" fill="#fff"/><rect x="0" y="16" width="24" height="8" fill="#000"/><circle cx="12" cy="12" r="2.2" fill="#c09300"/></g></svg>',
  ZAR: '<svg viewBox="0 0 24 24"><defs><clipPath id="fza"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fza)"><rect x="0" y="0" width="24" height="24" fill="#fff"/><rect x="0" y="0" width="24" height="8" fill="#e03c31"/><rect x="0" y="16" width="24" height="8" fill="#001489"/><path d="M0 0l10 12L0 24z" fill="#007749"/><path d="M0 2l8 10-8 10z" fill="#ffb612"/><path d="M0 4l6.5 8L0 20z" fill="#000"/></g></svg>',
  XOF: '<svg viewBox="0 0 24 24"><defs><clipPath id="fxo"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fxo)"><rect x="0" y="0" width="8" height="24" fill="#009e60"/><rect x="8" y="0" width="8" height="24" fill="#fcd116"/><rect x="16" y="0" width="8" height="24" fill="#ce1126"/></g></svg>',
  TZS: '<svg viewBox="0 0 24 24"><defs><clipPath id="ftz"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#ftz)"><polygon points="0,0 24,0 0,24" fill="#1eb53a"/><polygon points="24,0 24,24 0,24" fill="#00a3dd"/><line x1="24" y1="0" x2="0" y2="24" stroke="#fcd116" stroke-width="4.5"/><line x1="24" y1="0" x2="0" y2="24" stroke="#000" stroke-width="2"/></g></svg>',
  ETB: '<svg viewBox="0 0 24 24"><defs><clipPath id="fet"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fet)"><rect x="0" y="0" width="24" height="8" fill="#078930"/><rect x="0" y="8" width="24" height="8" fill="#fcdd09"/><rect x="0" y="16" width="24" height="8" fill="#da121a"/><circle cx="12" cy="12" r="4.5" fill="#0f47af"/><path d="M12 8.6l0.9 2.7h2.9l-2.3 1.7 0.9 2.7-2.3-1.7-2.3 1.7 0.9-2.7-2.3-1.7h2.9z" fill="#fcdd09"/></g></svg>',
  UGX: '<svg viewBox="0 0 24 24"><defs><clipPath id="fug"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fug)"><rect x="0" y="0" width="24" height="4" fill="#000"/><rect x="0" y="4" width="24" height="4" fill="#fcdc04"/><rect x="0" y="8" width="24" height="4" fill="#d90000"/><rect x="0" y="12" width="24" height="4" fill="#000"/><rect x="0" y="16" width="24" height="4" fill="#fcdc04"/><rect x="0" y="20" width="24" height="4" fill="#d90000"/><circle cx="12" cy="12" r="3.2" fill="#fff"/></g></svg>',
  ZMW: '<svg viewBox="0 0 24 24"><defs><clipPath id="fzm"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fzm)"><rect x="0" y="0" width="24" height="24" fill="#198a00"/><rect x="13" y="10" width="3.7" height="14" fill="#de2010"/><rect x="16.7" y="10" width="3.6" height="14" fill="#000"/><rect x="20.3" y="10" width="3.7" height="14" fill="#ef7d00"/><path d="M15 6.5c1.6-1.4 3.6-1.4 5.2 0" stroke="#ef7d00" stroke-width="1.2" fill="none"/></g></svg>',
  MAD: '<svg viewBox="0 0 24 24"><defs><clipPath id="fma"><circle cx="12" cy="12" r="12"/></clipPath></defs><g clip-path="url(#fma)"><rect x="0" y="0" width="24" height="24" fill="#c1272d"/><polygon points="12,6.2 13.7,11.4 19.1,11.4 14.7,14.6 16.4,19.8 12,16.6 7.6,19.8 9.3,14.6 4.9,11.4 10.3,11.4" fill="none" stroke="#006233" stroke-width="1"/></g></svg>',
};

function fallbackFlag(code: string): string {
  const t = (code || '?').slice(0, 3).toUpperCase();
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#262626"/><text x="12" y="15" text-anchor="middle" font-family="Geist Mono, monospace" font-size="7.5" font-weight="600" fill="#b5b5b5">${t}</text></svg>`;
}

function Raw({ html }: { html: string }) {
  // display:contents keeps the wrapper out of the box model so scoped
  // `.coin svg`, `.mkt-fl svg` rules size the inner SVG directly.
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function FlagSvg({ code }: { code: string }) {
  return <Raw html={FLAGS[code] || fallbackFlag(code)} />;
}

/** Currency codes we have a real flag for (used to decide flag vs fallback). */
export const KNOWN_FLAGS = Object.keys(FLAGS);
