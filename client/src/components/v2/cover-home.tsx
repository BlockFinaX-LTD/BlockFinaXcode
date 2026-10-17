/**
 * Two experiences, one question each:
 *   Hedger: "What do you want to protect?"
 *   Underwriter: "How do you want your capital exposed?"
 */
import { useState } from 'react';
import { Layers, ShieldCheck } from 'lucide-react';
import { Hedger } from './hedger';
import { Underwriter } from './underwriter';

export function CoverHome() {
  const [role, setRole] = useState<'hedger' | 'underwriter'>(() => {
    try { return localStorage.getItem('bfx:cover-role') === 'underwriter' ? 'underwriter' : 'hedger'; } catch { return 'hedger'; }
  });
  const choose = (r: 'hedger' | 'underwriter') => {
    setRole(r);
    try { localStorage.setItem('bfx:cover-role', r); } catch { /* per-viewer convenience only */ }
  };
  return (
    <>
      <div className="page-head">
        <div className="ph-l">
          <h1>{role === 'hedger' ? 'What do you want to protect?' : 'How do you want your capital exposed?'}</h1>
          <p>{role === 'hedger'
            ? 'Protect a payment or receivable against a currency move. Everything is in USDC and network fees are covered.'
            : 'Commit USDC to a currency risk and earn the premiums hedgers pay. You set the price; BlockFinaX handles the rest.'}</p>
        </div>
      </div>
      <div className="cv-tabs">
        <button className={role === 'hedger' ? 'on' : ''} onClick={() => choose('hedger')}><ShieldCheck /> Hedger</button>
        <button className={role === 'underwriter' ? 'on' : ''} onClick={() => choose('underwriter')}><Layers /> Underwriter</button>
      </div>
      {role === 'hedger' ? <Hedger /> : <Underwriter />}
    </>
  );
}
