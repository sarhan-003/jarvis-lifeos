import { useCallback, useEffect, useState } from 'react';

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'en-US' && /female|samantha|aria|jenny|zira/i.test(v.name)) ?? voices.find((v) => v.lang === 'en-US') ?? voices[0];
}

export function useSpeechSynthesis() {
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem('pc.voice') !== 'off';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('pc.voice', enabled ? 'on' : 'off');
    } catch {
      /* storage unavailable: keep the in-memory setting */
    }
    if (!enabled && supported) window.speechSynthesis.cancel();
  }, [enabled]);

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      if (!supported || !enabled || !text) {
        onDone?.();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) u.voice = voice;
      u.lang = 'en-US';
      u.rate = 1.03;
      u.onstart = () => setSpeaking(true);
      u.onend = () => {
        setSpeaking(false);
        onDone?.();
      };
      // Interrupted or failed speech must not reopen the mic.
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [enabled],
  );

  return { supported, speaking, enabled, setEnabled, speak, cancel };
}
