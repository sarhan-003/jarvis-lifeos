import type { ToolCallTrace } from '../types';

export interface TraceTurn {
  id: number;
  message: string;
  engine: string;
  calls: ToolCallTrace[];
}

/** Side panel listing the real MCP tool calls behind each answer. */
export function ToolTrace({ turns, onClose }: { turns: TraceTurn[]; onClose: () => void }) {
  return (
    <aside className="flex h-full flex-col border-l border-line bg-panel/95" aria-label="MCP tool trace">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-white">MCP tool trace</h2>
          <p className="text-xs text-slate-400">tools/call requests to the Parcel Concierge server</p>
        </div>
        <button className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/5 hover:text-white" onClick={onClose} aria-label="Close trace">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!turns.length && <p className="text-sm text-slate-500">Tool calls will appear here as you talk.</p>}
        {[...turns].reverse().map((t) => (
          <div key={t.id}>
            <p className="mb-1 text-xs text-slate-400">
              “{t.message}” · <span className="text-slate-500">{t.engine}</span>
            </p>
            {!t.calls.length && <p className="text-xs text-slate-500">No tool calls</p>}
            {t.calls.map((c, i) => (
              <details key={i} className="mb-2 rounded-lg border border-line bg-black/25 open:bg-black/40">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${c.isError ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                  <code className="font-mono text-sky-300">{c.name}</code>
                  <span className="ml-auto text-slate-500">{c.durationMs} ms</span>
                </summary>
                <pre className="overflow-x-auto px-3 pb-2 font-mono text-[11px] text-slate-300">{JSON.stringify(c.args, null, 2)}</pre>
                <p className="px-3 pb-2 text-[11px] text-slate-400">{c.text}</p>
              </details>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}
