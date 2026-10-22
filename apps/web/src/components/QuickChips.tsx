export const DEMO_PHRASES = [
  'Where are my packages?',
  'Why is my phone stuck in customs?',
  'Okay, pay the duty.',
  'I sent the invoice — mark it uploaded.',
  "I won't be home tomorrow, can the books come Saturday evening?",
  'Leave my running shoes with Sam next door.',
  'The coffee machine delivery failed — my unit is 12B.',
  'Was my headphones parcel delivered? I want to return them.',
];

export function QuickChips({ onSay, disabled }: { onSay: (t: string) => void; disabled: boolean }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      {DEMO_PHRASES.map((p) => (
        <button
          key={p}
          disabled={disabled}
          onClick={() => onSay(p)}
          className="shrink-0 rounded-full border border-line bg-panel-2/80 px-3 py-1.5 text-xs text-slate-300 hover:border-glow hover:text-white disabled:opacity-40"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
