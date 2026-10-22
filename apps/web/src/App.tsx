import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Card, HealthResponse, Status } from './types';
import { getHealth, resetDemo, sendMessage } from './api';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';
import { LightBar } from './components/LightBar';
import { MicButton } from './components/MicButton';
import { Transcript } from './components/Transcript';
import { QuickChips } from './components/QuickChips';
import { ToolTrace, type TraceTurn } from './components/ToolTrace';
import { CardView } from './components/cards/CardView';

function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem('pc.session');
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem('pc.session', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

let turnId = 0;

export default function App() {
  const [sessionId] = useState(getSessionId);
  const [thinking, setThinking] = useState(false);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState<string | undefined>();
  const [cards, setCards] = useState<Card[]>([]);
  const [turns, setTurns] = useState<TraceTurn[]>([]);
  const [showTrace, setShowTrace] = useState(() => window.innerWidth >= 1100);
  const [text, setText] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tts = useSpeechSynthesis();
  const inputRef = useRef<HTMLInputElement>(null);

  // Retry while the agent API is still starting (dev servers boot in parallel).
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (attempt: number) => {
      getHealth()
        .then((h) => {
          if (cancelled) return;
          setHealth(h);
          if (!h.mcp.reachable && attempt < 10) timer = setTimeout(() => check(attempt + 1), 2000);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          if (attempt < 10) timer = setTimeout(() => check(attempt + 1), 1500);
          else setError(e.message);
        });
    };
    check(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const send = useCallback(
    async (message: string) => {
      const m = message.trim();
      if (!m || thinking) return;
      tts.cancel();
      setHeard(m);
      setThinking(true);
      setError(null);
      try {
        const res = await sendMessage(sessionId, m);
        setReply(res.speech);
        setNotice(res.notice);
        setCards(res.cards);
        setTurns((t) => [...t, { id: ++turnId, message: m, engine: res.engine, calls: res.toolCalls }].slice(-30));
        tts.speak(res.speech);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setThinking(false);
      }
    },
    [sessionId, thinking, tts],
  );

  const voice = useSpeechRecognition((spoken) => void send(spoken));
  const status: Status = voice.listening ? 'listening' : thinking ? 'thinking' : tts.speaking ? 'speaking' : 'idle';

  // Space = push to talk, unless typing in the text box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLButtonElement) return;
      e.preventDefault();
      if (voice.listening) voice.stop();
      else if (!thinking) {
        tts.cancel();
        voice.start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice, thinking, tts]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
    setText('');
  };

  const reset = async () => {
    tts.cancel();
    try {
      await resetDemo(sessionId);
      setReply('Demo reset. All parcels are back to their starting state.');
      setHeard('');
      setCards([]);
      setTurns([]);
      setNotice(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const idleHint = voice.supported ? 'Press the mic or Space and ask about your parcels.' : 'Voice works best in Chrome — use the text box.';

  return (
    <div className="grid h-full grid-rows-[auto_1fr] lg:grid-cols-[1fr_auto] lg:grid-rows-[auto_1fr]">
      <header className="col-span-full flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-glow to-glow-2 text-lg" aria-hidden="true">
            📦
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">Parcel Concierge</h1>
            <p className="text-xs text-slate-400">Simulated Alexa+ experience · SwiftLane Express (fictional)</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 ${health?.mcp.reachable ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`} title={health?.mcp.url}>
            MCP {health ? (health.mcp.reachable ? `· ${health.mcp.tools} tools` : 'offline') : '…'}
          </span>
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-slate-300" title={health?.engineWarning}>
            {health?.engine ?? 'Engine…'}
          </span>
          <button className={`rounded-full border px-3 py-1 ${tts.enabled ? 'border-glow/50 text-sky-300' : 'border-line text-slate-400'}`} onClick={() => tts.setEnabled(!tts.enabled)} disabled={!tts.supported} aria-pressed={tts.enabled}>
            {tts.enabled ? '🔊 Voice' : '🔇 Muted'}
          </button>
          <button className={`rounded-full border px-3 py-1 ${showTrace ? 'border-glow/50 text-sky-300' : 'border-line text-slate-300'}`} onClick={() => setShowTrace((s) => !s)} aria-pressed={showTrace}>
            Tool trace
          </button>
          <button className="rounded-full border border-line px-3 py-1 text-slate-300 hover:bg-white/5" onClick={() => void reset()}>
            Reset demo
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-col lg:col-start-1 lg:row-start-2">
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mx-auto max-w-3xl space-y-5">
            {reply || heard ? <Transcript heard={heard} interim={voice.interim} reply={reply} notice={notice} /> : (
              <div className="pt-6 sm:pt-12">
                <p className="text-3xl font-light text-white sm:text-4xl">Hi Alex. What can I help with?</p>
                <p className="mt-2 text-slate-400">{idleHint}</p>
                {voice.interim && <p className="mt-3 italic text-slate-300">“{voice.interim}”</p>}
              </div>
            )}
            {thinking && <p className="text-sm text-sky-300">Checking with SwiftLane…</p>}
            {(error || voice.error) && (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" role="alert">
                {error ?? voice.error}
              </div>
            )}
            <div className="grid gap-4">
              {cards.map((c, i) => (
                <CardView key={`${c.type}-${i}`} card={c} onSay={(t) => void send(t)} active={!thinking} />
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-line bg-stage/80 px-4 pb-4 pt-3 backdrop-blur sm:px-8">
          <div className="mx-auto max-w-3xl space-y-3">
            <QuickChips onSay={(t) => void send(t)} disabled={thinking} />
            <form onSubmit={submit} className="flex items-center gap-3">
              <MicButton listening={voice.listening} disabled={thinking} supported={voice.supported} onStart={() => { tts.cancel(); voice.start(); }} onStop={voice.stop} />
              <label htmlFor="say" className="sr-only">
                Type a request
              </label>
              <input
                id="say"
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='Type a request, e.g. "Where are my packages?"'
                autoComplete="off"
                maxLength={2000}
                className="min-w-0 flex-1 rounded-full border border-line bg-panel-2 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-glow focus:outline-none"
              />
              <button disabled={thinking || !text.trim()} className="rounded-full bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40">
                Send
              </button>
            </form>
            <LightBar status={status} />
          </div>
        </div>
      </main>

      {showTrace && (
        <div className="fixed inset-y-0 right-0 z-20 w-[min(380px,90vw)] lg:static lg:col-start-2 lg:row-start-2 lg:w-[360px] lg:min-h-0">
          <ToolTrace turns={turns} onClose={() => setShowTrace(false)} />
        </div>
      )}
    </div>
  );
}
