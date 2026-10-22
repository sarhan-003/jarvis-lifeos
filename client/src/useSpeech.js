// Browser speech: Web Speech API recognition for input, speechSynthesis for
// output. Both degrade gracefully: `supported` flags tell the UI what to show.
import { useCallback, useEffect, useRef, useState } from 'react';

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export function useSpeechInput(onFinal) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => recRef.current?.stop(), []);

  const start = useCallback(() => {
    if (!Recognition) return;
    setError(null);
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = '';
      let final = false;
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) final = true;
      }
      setInterim(text);
      if (final && text.trim()) onFinalRef.current(text.trim());
    };
    rec.onerror = (e) => {
      const messages = {
        'not-allowed': 'Microphone permission was denied. You can keep typing instead.',
        'no-speech': "I didn't hear anything. Try again or type your request.",
        network: 'Speech recognition needs a network connection in this browser.',
        'audio-capture': 'No microphone was found.',
      };
      if (e.error !== 'aborted') setError(messages[e.error] || `Voice input error: ${e.error}`);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported: Boolean(Recognition), listening, interim, error, start, stop };
}

export function useSpeechOutput() {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem('jarvis.tts') !== 'off';
    } catch {
      return true;
    }
  });
  const [speaking, setSpeaking] = useState(false);

  const toggle = useCallback(() => {
    setEnabled((on) => {
      try {
        localStorage.setItem('jarvis.tts', on ? 'off' : 'on');
      } catch {
        /* storage unavailable: keep the in-memory setting */
      }
      if (on && supported) window.speechSynthesis.cancel();
      return !on;
    });
  }, [supported]);

  const speak = useCallback(
    (text) => {
      if (!supported || !enabled || !text) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported, enabled],
  );

  return { supported, enabled, speaking, toggle, speak };
}
