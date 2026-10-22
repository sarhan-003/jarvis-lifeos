import type { ShipmentStatus } from './types';

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Today", "Tomorrow" or "Sat, Oct 24" */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const today = todayIso();
  if (iso === today) return 'Today';
  const t = parse(today);
  t.setDate(t.getDate() + 1);
  const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  if (iso === tomorrow) return 'Tomorrow';
  return parse(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export const formatDateTime = (isoTs: string) =>
  new Date(isoTs).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const usd = (n: number) => `$${n.toFixed(2)}`;

export const STATUS_STYLE: Record<ShipmentStatus, string> = {
  LabelCreated: 'bg-slate-500/20 text-slate-300',
  InTransit: 'bg-sky-500/15 text-sky-300',
  ArrivedInCountry: 'bg-sky-500/15 text-sky-300',
  CustomsHold: 'bg-amber-500/15 text-amber-300',
  OutForDelivery: 'bg-emerald-500/15 text-emerald-300',
  Delivered: 'bg-emerald-500/15 text-emerald-300',
  DeliveryException: 'bg-rose-500/15 text-rose-300',
  ReturnRequested: 'bg-violet-500/15 text-violet-300',
};

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  LabelCreated: 'Label created',
  InTransit: 'In transit',
  ArrivedInCountry: 'Cleared customs',
  CustomsHold: 'Customs hold',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered',
  DeliveryException: 'Delivery problem',
  ReturnRequested: 'Return requested',
};
