export function MicButton({ listening, disabled, supported, onStart, onStop }: { listening: boolean; disabled: boolean; supported: boolean; onStart: () => void; onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      disabled={disabled || !supported}
      aria-pressed={listening}
      aria-label={listening ? 'Stop listening' : 'Talk (Space)'}
      title={supported ? 'Push to talk (Space)' : 'Voice works best in Chrome or Edge. Use the text box.'}
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border text-xl transition ${
        listening ? 'border-glow bg-glow/20 text-white shadow-[0_0_20px] shadow-glow/60' : 'border-line bg-panel-2 text-sky-300 hover:border-glow'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
      </svg>
    </button>
  );
}
