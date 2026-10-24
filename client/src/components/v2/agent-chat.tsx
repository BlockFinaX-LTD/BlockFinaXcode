/**
 * Ask BlockFinaX: the customer agent inside the workspace.
 *
 * The server scopes every thread to the signed-in wallet, so the agent can answer about this
 * user's own protections and limits. The thread id is remembered per user in this browser.
 */
import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { usePasskeySession } from '@/lib/identity';
import { api } from '@/lib/wallets/passkey-wallet';
import { Spin } from './ui';

interface Msg { id?: number; role: 'user' | 'assistant'; content: string }

const SUGGESTIONS = [
  'How does payables protection work?',
  'What would protecting $10,000 of naira for 30 days cost?',
  'How do I raise my verification limit?',
];

function threadKey(userId: number | undefined) {
  return `bfx:agent-thread:${userId ?? 'anon'}`;
}

function threadFor(userId: number | undefined): string {
  const key = threadKey(userId);
  try {
    const have = localStorage.getItem(key);
    if (have) return have;
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}

export function AgentChat() {
  const { session } = usePasskeySession();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const thread = threadFor(session?.user.id);

  useEffect(() => {
    if (!open || loaded || !session) return;
    api<Msg[]>(`/api/chat/customer/${encodeURIComponent(thread)}`)
      .then((rows) => setMsgs(rows))
      .catch(() => { /* a new thread has no history */ })
      .finally(() => setLoaded(true));
  }, [open, loaded, session, thread]);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);

  async function send(message: string) {
    const m = message.trim();
    if (!m || busy) return;
    setText('');
    setError(null);
    setMsgs((x) => [...x, { role: 'user', content: m }]);
    setBusy(true);
    try {
      const { reply } = await api<{ reply: string }>('/api/chat/customer', { threadId: thread, message: m });
      setMsgs((x) => [...x, { role: 'assistant', content: reply }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    try { localStorage.removeItem(threadKey(session?.user.id)); } catch { /* ignore */ }
    setMsgs([]);
    setLoaded(true);
    setError(null);
  }

  return (
    <>
      {!open && (
        <button className="bx-agent-fab" onClick={() => setOpen(true)} aria-label="Ask BlockFinaX">
          <MessageCircle /> <span>Ask BlockFinaX</span>
        </button>
      )}
      {open && (
        <div className="bx-agent" role="dialog" aria-label="Ask BlockFinaX">
          <div className="bx-agent-h">
            <div><div style={{ fontWeight: 600 }}>Ask BlockFinaX</div><div className="muted" style={{ fontSize: 12 }}>Answers about protection, pools, limits and your account</div></div>
            <div style={{ display: 'flex', gap: 6 }}>
              {msgs.length > 0 && <button className="bx-btn ghost small" onClick={newChat}>New chat</button>}
              <button className="bx-icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X /></button>
            </div>
          </div>
          <div className="bx-agent-list" ref={list}>
            {msgs.length === 0 && !busy && (
              <div className="bx-agent-empty">
                <div className="muted" style={{ marginBottom: 10 }}>Ask anything about hedging with BlockFinaX. For example:</div>
                {SUGGESTIONS.map((q) => <button key={q} className="bx-pill" style={{ width: '100%', textAlign: 'left', padding: '10px 14px', marginBottom: 6 }} onClick={() => send(q)}>{q}</button>)}
              </div>
            )}
            {msgs.map((m, i) => <div key={m.id ?? i} className={`bx-agent-msg ${m.role}`}>{m.content}</div>)}
            {busy && <div className="bx-agent-msg assistant"><Spin /> Thinking...</div>}
            {error && <div className="bx-error" style={{ padding: '4px 2px' }}>{error}</div>}
          </div>
          <form className="bx-agent-in" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <input className="bx-input" placeholder="Type a question" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} aria-label="Message" />
            <button className="bx-btn" type="submit" disabled={busy || !text.trim()} aria-label="Send"><Send /></button>
          </form>
        </div>
      )}
    </>
  );
}
