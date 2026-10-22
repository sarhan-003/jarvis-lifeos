import type { Card } from '../../types';
import { formatDateTime, formatDay } from '../../format';
import { CardShell } from './CardShell';

export function PodCard({ data, onSay }: { data: Extract<Card, { type: 'pod' }>['data']; onSay: (t: string) => void }) {
  return (
    <CardShell title={`Your ${data.nickname} ${/[^s]s$/i.test(data.nickname) ? 'were' : 'was'} delivered`} tone="ok">
      <div className="flex gap-4">
        <div className="grid h-24 w-28 shrink-0 place-items-center rounded-xl border border-line bg-gradient-to-br from-slate-700/40 to-slate-900 text-3xl" aria-label="Delivery photo placeholder">
          📦
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-400">When</dt>
          <dd className="text-white">{formatDateTime(data.deliveredAt)}</dd>
          <dt className="text-slate-400">Left at</dt>
          <dd className="capitalize text-white">{data.leftAt}</dd>
          <dt className="text-slate-400">Photo</dt>
          <dd className="truncate text-slate-300">{data.photoRef}</dd>
          {data.returnEligibleUntil && (
            <>
              <dt className="text-slate-400">Returns</dt>
              <dd className="text-slate-300">until {formatDay(data.returnEligibleUntil)}</dd>
            </>
          )}
        </dl>
      </div>
      {data.returnEligibleUntil && (
        <button className="mt-3 rounded-full border border-line px-4 py-2 text-sm hover:bg-white/5" onClick={() => onSay(`I want to return my ${data.nickname}`)}>
          Return it
        </button>
      )}
    </CardShell>
  );
}

export function ReturnCard({ data }: { data: Extract<Card, { type: 'return' }>['data'] }) {
  return (
    <CardShell title="Return pickup booked" subtitle={data.id} tone="ok">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-400">Parcel</dt>
        <dd className="capitalize text-white">{data.nickname}</dd>
        <dt className="text-slate-400">Pickup</dt>
        <dd className="text-white">
          {formatDay(data.pickupDate)}, {data.pickupWindow} ({data.windowLabel})
        </dd>
        <dt className="text-slate-400">Reason</dt>
        <dd className="text-slate-300">{data.reason}</dd>
        <dt className="text-slate-400">Label</dt>
        <dd className="text-slate-300">{data.labelDelivery}</dd>
      </dl>
    </CardShell>
  );
}

export function ErrorCard({ data, onSay }: { data: Extract<Card, { type: 'error' }>['data']; onSay: (t: string) => void }) {
  return (
    <CardShell title="Couldn't do that" tone="error">
      <p className="text-sm text-slate-200">{data.message}</p>
      {data.candidates && data.candidates.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.candidates.map((c) => (
            <button key={c} className="rounded-full border border-line px-3 py-1 text-sm capitalize hover:bg-white/5" onClick={() => onSay(`Where is my ${c}?`)}>
              {c}
            </button>
          ))}
        </div>
      )}
    </CardShell>
  );
}
