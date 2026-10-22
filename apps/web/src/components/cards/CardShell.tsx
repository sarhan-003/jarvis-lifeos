import type { ReactNode } from 'react';
import type { ShipmentStatus } from '../../types';
import { STATUS_LABEL, STATUS_STYLE } from '../../format';

export function CardShell({ title, subtitle, children, tone = 'default' }: { title: string; subtitle?: string; children: ReactNode; tone?: 'default' | 'warn' | 'error' | 'ok' }) {
  const border = { default: 'border-line', warn: 'border-amber-400/30', error: 'border-rose-400/40', ok: 'border-emerald-400/30' }[tone];
  return (
    <section className={`rounded-2xl border ${border} bg-panel/90 p-4 shadow-xl shadow-black/30 sm:p-5`}>
      <header className="mb-3">
        <h3 className="text-base font-semibold text-white sm:text-lg">{title}</h3>
        {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}
