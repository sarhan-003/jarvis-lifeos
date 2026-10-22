import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechRecognitionCtor, SpeechRecognitionLike, SpeechWindow } from '../speech';

const Ctor: SpeechRecognitionCtor | undefined =
  typeof window !== 'undefined' ? ((window as unknown as SpeechWindow).SpeechRecognition ?? (window as unknown as SpeechWindow).webkitSpeechRecognition) : undefined;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. Use the text box instead.',
  'no-speech': "I didn't hear anything. Try again or type your request.",
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs a network connection in this browser.',
};

export function useSpeechRecognition(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    if (!Ctor || rec.current) return;
    setError(null);
    const r = new Ctor();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const result = e.results[i];
        if (!result) continue;
        text += result[0]?.transcript ?? '';
        if (result.isFinal) isFinal = true;
      }
      setInterim(text);
      if (isFinal && text.trim()) finalRef.current(text.trim());
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `Voice input error: ${e.error}`);
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      setInterim('');
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch (err) {
      rec.current = null;
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported: Boolean(Ctor), listening, interim, error, start, stop };
}
