import type { ConfirmationData } from '../../types';
import { CardShell } from './CardShell';

export function ConfirmationCard({ data, onSay, active }: { data: ConfirmationData; onSay: (t: string) => void; active: boolean }) {
  const tone = data.needsAnswer ? 'warn' : 'ok';
  return (
    <CardShell title={data.title} tone={tone}>
      <ul className="mb-3 space-y-1 text-sm text-slate-300">
        {data.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {data.needsAnswer && active && (
        <div className="flex gap-2">
          <button className="rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400" onClick={() => onSay('Yes')}>
            Confirm
          </button>
          <button className="rounded-full border border-line px-5 py-2 text-sm hover:bg-white/5" onClick={() => onSay('No, cancel')}>
            Cancel
          </button>
        </div>
      )}
      {!data.needsAnswer && <p className="text-sm font-medium text-emerald-300">✓ Done</p>}
    </CardShell>
  );
}
