import type { Card } from '../../types';
import { formatDay } from '../../format';
import { CardShell, StatusBadge } from './CardShell';

export function ShipmentListCard({ data, onSay }: { data: Extract<Card, { type: 'shipment_list' }>['data']; onSay: (t: string) => void }) {
  return (
    <CardShell title={`${data.count} parcel${data.count === 1 ? '' : 's'}`} subtitle="SwiftLane Express · soonest first">
      <ul className="divide-y divide-line">
        {data.shipments.map((s) => (
          <li key={s.id}>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-white/5"
              onClick={() => onSay(s.status === 'CustomsHold' ? `Why is my ${s.nickname} stuck in customs?` : `Where is my ${s.nickname}?`)}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium capitalize text-white">{s.nickname}</div>
                <div className="truncate text-xs text-slate-400">{s.itemDescription}</div>
                {s.needsAction && <div className="mt-0.5 text-xs text-amber-300">⚠ {s.needsAction}</div>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={s.status} />
                <span className="text-xs text-slate-400">{s.eta ? `${formatDay(s.eta)}${s.deliveryWindow ? ` · ${s.deliveryWindow}` : ''}` : 'No ETA'}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
