import type { TrackingView } from '../../types';
import { formatDateTime, formatDay } from '../../format';
import { CardShell, StatusBadge } from './CardShell';

export function TimelineCard({ data }: { data: TrackingView }) {
  return (
    <CardShell title={`Your ${data.nickname}`} subtitle={`${data.trackingNumber} · from ${data.merchant}`}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={data.status} />
        {data.eta && (
          <span className="text-sm text-slate-300">
            ETA <b className="text-white">{formatDay(data.eta)}</b>
            {data.deliveryWindow ? `, ${data.deliveryWindow}` : ''}
          </span>
        )}
        {data.deliveryInstructions && <span className="text-sm text-sky-300">📍 {data.deliveryInstructions}</span>}
      </div>
      <ol className="relative ml-2 border-l border-line">
        {data.recentEvents.map((e, i) => (
          <li key={`${e.timestamp}-${i}`} className="mb-3 ml-4 last:mb-0">
            <span className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${i === 0 ? 'bg-glow shadow-[0_0_10px] shadow-glow' : 'bg-slate-600'}`} />
            <p className={`text-sm ${i === 0 ? 'font-medium text-white' : 'text-slate-300'}`}>{e.description}</p>
            <p className="text-xs text-slate-500">
              {formatDateTime(e.timestamp)} · {e.location}
            </p>
          </li>
        ))}
      </ol>
    </CardShell>
  );
}
