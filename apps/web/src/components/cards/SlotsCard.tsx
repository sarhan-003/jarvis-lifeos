import type { Card } from '../../types';
import { formatDay } from '../../format';
import { CardShell } from './CardShell';

export function SlotsCard({ data, onSay }: { data: Extract<Card, { type: 'slots' }>['data']; onSay: (t: string) => void }) {
  return (
    <CardShell title={`Delivery slots for your ${data.nickname}`} subtitle={data.currentEta ? `Currently due ${formatDay(data.currentEta)}` : undefined}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.slots.map((s) => (
          <button
            key={`${s.date}-${s.window}`}
            className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-left text-sm hover:border-glow hover:bg-sky-500/10"
            onClick={() => onSay(`Reschedule my ${data.nickname} to ${s.date} ${s.window}`)}
          >
            <div className="font-medium text-white">{formatDay(s.date)}</div>
            <div className="text-xs capitalize text-slate-400">{s.window}</div>
          </button>
        ))}
      </div>
    </CardShell>
  );
}
