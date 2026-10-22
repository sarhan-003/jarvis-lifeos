import type { CustomsView } from '../../types';
import { usd } from '../../format';
import { CardShell } from './CardShell';

const DOC_LABEL = { commercial_invoice: 'Commercial invoice', id_proof: 'Proof of ID' } as const;

export function CustomsCard({ data, onSay }: { data: CustomsView; onSay: (t: string) => void }) {
  if (!data.inCustoms) {
    return (
      <CardShell title={`Your ${data.nickname}: no customs hold`} tone="ok">
        <p className="text-sm text-slate-300">{data.nextStep}</p>
      </CardShell>
    );
  }
  const d = data.duty;
  return (
    <CardShell title={`Your ${data.nickname} is held in customs`} subtitle={`${data.trackingNumber}${data.hsCode ? ` · HS code ${data.hsCode}` : ''}`} tone="warn">
      <ul className="mb-4 space-y-1.5">
        {data.holdReasons.map((r) => (
          <li key={r.code} className="flex gap-2 text-sm text-slate-200">
            <span className="text-amber-300">●</span>
            {r.text}
          </li>
        ))}
      </ul>
      {data.missingDocuments.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-400">Documents</p>
          {data.missingDocuments.map((doc) => (
            <label key={doc} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled className="accent-sky-400" /> {DOC_LABEL[doc]} <span className="text-amber-300">missing</span>
            </label>
          ))}
        </div>
      )}
      {d && (
        <div className="mb-4 rounded-xl bg-black/25 p-3 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>
              Duty {d.ratePercent}% × {usd(d.declaredValueUsd)}
            </span>
            <span>{usd(d.duty)}</span>
          </div>
          <div className="flex justify-between text-slate-300">
            <span>Processing fee</span>
            <span>{usd(d.fee)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold text-white">
            <span>Total {data.isPaid ? '(paid)' : 'due'}</span>
            <span>{usd(d.total)}</span>
          </div>
        </div>
      )}
      <p className="mb-3 text-sm text-sky-200">{data.nextStep}</p>
      <div className="flex flex-wrap gap-2">
        {!data.isPaid && d && (
          <button className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400" onClick={() => onSay('Pay the duty')}>
            Pay duty
          </button>
        )}
        {data.missingDocuments.includes('commercial_invoice') && (
          <button className="rounded-full border border-line px-4 py-2 text-sm hover:bg-white/5" onClick={() => onSay('I sent the invoice, mark it uploaded')}>
            I sent the invoice
          </button>
        )}
      </div>
    </CardShell>
  );
}
