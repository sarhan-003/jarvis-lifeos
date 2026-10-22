// Simulated Alexa+ conversation with voice + text input. Each reply shows the
// path it took: the user's words, the assistant engine, the MCP tools/call
// requests to the Jarvis LifeOS server, and their real results.
import { useEffect, useRef, useState } from 'react';
import ActionCard from './ActionCard.jsx';
import { useSpeechInput } from '../useSpeech.js';

const SUGGESTIONS = [
  'Alexa, ask Jarvis to create a task to revise binary trees tomorrow',
  'Alexa, ask Jarvis to show my pending tasks',
  'Alexa, ask Jarvis to create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming',
  'Alexa, ask Jarvis to mark binary trees complete',
  'Alexa, ask Jarvis for my daily summary',
];

function McpTrace({ message }) {
  const calls = message.actions?.filter((a) => a.via === 'mcp') ?? [];
  if (!message.mcp) return null;
  return (
    <div className="trace" aria-label="How this request was handled">
      <span className="trace-step">🎙 You</span>
      <span className="trace-arrow">→</span>
      <span className="trace-step">Alexa+ sim · {message.provider ?? 'assistant'}</span>
      <span className="trace-arrow">→</span>
      <span className="trace-step trace-mcp">
        MCP {message.mcp.transport === 'streamable-http' ? 'Streamable HTTP' : 'in-process'} · {message.mcp.toolsDiscovered} tools
      </span>
      {calls.map((a) => (
        <span key={a.id} className="trace-call">
          <span className="trace-arrow">→</span>
          <code>tools/call {a.tool}</code>
          <span className={`trace-dot trace-${a.status}`} aria-label={a.status} />
        </span>
      ))}
    </div>
  );
}

export default function Chat({ messages, sending, onSend, onResolve, tts, engine }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const mounted = useRef(false);
  const voice = useSpeechInput((spoken) => onSend(spoken));

  useEffect(() => {
    // Jump straight to the latest message on load; animate for new ones.
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: mounted.current ? 'smooth' : 'auto' });
    mounted.current = true;
  }, [messages, sending]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    onSend(text.trim());
    setText('');
  };

  const orbState = voice.listening ? 'listening' : sending ? 'thinking' : tts.speaking ? 'speaking' : 'idle';
  const orbLabel = {
    listening: 'Listening…',
    thinking: 'Calling Jarvis over MCP…',
    speaking: 'Speaking…',
    idle: voice.supported ? 'Tap the ring and speak' : 'Type below',
  }[orbState];

  return (
    <section className="panel chat" aria-label="Alexa+ simulator conversation">
      <div className="chat-hero">
        <button
          className={`orb orb-${orbState}`}
          onClick={voice.listening ? voice.stop : voice.start}
          disabled={!voice.supported || sending}
          aria-label={voice.listening ? 'Stop listening' : 'Start voice input'}
          title={voice.supported ? '' : 'Speech recognition is not supported in this browser'}
        >
          <span className="orb-core" />
        </button>
        <div>
          <div className="orb-label">{orbLabel}</div>
          <div className="dim small">
            Simulated Alexa+{engine ? ` · ${engine}` : ''} · say “Alexa, ask Jarvis to…”
            {!voice.supported && ' · voice input needs Chrome or Edge, typing works everywhere'}
          </div>
        </div>
        <button className={`btn btn-ghost tts-toggle${tts.enabled ? ' on' : ''}`} onClick={tts.toggle} disabled={!tts.supported} aria-pressed={tts.enabled}>
          {tts.supported ? (tts.enabled ? '🔊 Voice replies on' : '🔇 Voice replies off') : 'No speech output'}
        </button>
      </div>

      <div className="messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="empty">
            <p>
              This is a simulated Alexa+ experience. Jarvis LifeOS is the integration behind it: every request below is handled through its MCP server. Try one:
            </p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => onSend(s)} disabled={sending}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="bubble">
              {m.text}
              {m.notice && <div className="notice">{m.notice}</div>}
            </div>
            {m.actions?.length > 0 && (
              <div className="msg-actions">
                {m.actions.map((a) => (
                  <ActionCard key={a.id} action={a} onResolve={onResolve} compact />
                ))}
              </div>
            )}
            {m.role === 'assistant' && (m.mcp ? <McpTrace message={m} /> : m.provider && <div className="msg-meta">via {m.provider}</div>)}
          </div>
        ))}
        {sending && (
          <div className="msg msg-assistant">
            <div className="bubble typing" aria-label="Jarvis is working">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        {voice.interim && <div className="interim">🎙 {voice.interim}</div>}
      </div>

      {voice.error && (
        <div className="alert" role="alert">
          {voice.error}
        </div>
      )}

      <form className="composer" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">
          Message Jarvis
        </label>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Try "Alexa, ask Jarvis to show my pending tasks"'
          autoComplete="off"
          maxLength={2000}
        />
        <button className="btn btn-primary" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
