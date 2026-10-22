// Conversation with voice + text input. Each assistant turn shows the tool
// actions the backend actually executed for it.
import { useEffect, useRef, useState } from 'react';
import ActionCard from './ActionCard.jsx';
import { useSpeechInput } from '../useSpeech.js';

const SUGGESTIONS = [
  'Create a task to revise binary trees tomorrow',
  'Show my pending tasks',
  'Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming',
  'Mark binary trees complete',
  "What's my daily summary?",
];

export default function Chat({ messages, sending, onSend, onResolve, tts }) {
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
  const orbLabel = { listening: 'Listening…', thinking: 'Working…', speaking: 'Speaking…', idle: voice.supported ? 'Tap to talk' : 'Type below' }[orbState];

  return (
    <section className="panel chat" aria-label="Conversation">
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
            {voice.supported ? 'Voice input via your browser' : 'Voice input unavailable in this browser. Text works everywhere.'}
          </div>
        </div>
        <button className={`btn btn-ghost tts-toggle${tts.enabled ? ' on' : ''}`} onClick={tts.toggle} disabled={!tts.supported} aria-pressed={tts.enabled}>
          {tts.supported ? (tts.enabled ? '🔊 Voice replies on' : '🔇 Voice replies off') : 'No speech output'}
        </button>
      </div>

      <div className="messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="empty">
            <p>Ask Jarvis to manage your tasks and study plans. Try one of these:</p>
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
            {m.provider && <div className="msg-meta">via {m.provider}</div>}
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
          placeholder='Try "Create a task to revise binary trees tomorrow"'
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
