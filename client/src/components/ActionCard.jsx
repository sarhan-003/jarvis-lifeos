// One tool execution: request, tool, status, real result or error, and
// confirm/cancel controls for destructive actions.
import { useState } from 'react';

const STATUS = {
  success: { label: 'Done', cls: 'ok' },
  error: { label: 'Failed', cls: 'err' },
  awaiting_confirmation: { label: 'Needs confirmation', cls: 'warn' },
  cancelled: { label: 'Cancelled', cls: 'muted' },
};

export function StatusBadge({ status }) {
  const s = STATUS[status] ?? { label: status, cls: 'muted' };
  return <span className={`badge badge-${s.cls}`}>{s.label}</span>;
}

function resultSummary(action) {
  const r = action.result;
  if (!r) return null;
  if (r.task) return `${r.task.title} · ${r.task.status}${r.task.dueDate ? ` · due ${r.task.dueDate}` : ''} · ${r.task.priority}`;
  if (r.tasks) return `${r.count} record${r.count === 1 ? '' : 's'} returned`;
  if (r.plan) return `${r.plan.date} · ${r.plan.blocks.filter((b) => b.type === 'study').length} focus blocks · ${r.plan.startTime}–${r.plan.endTime}`;
  if (r.deleted) return `Removed ${r.deleted.title}`;
  if (r.counts) return `${r.counts.dueToday} due · ${r.counts.overdue} overdue · ${r.counts.completedToday} done`;
  return null;
}

export default function ActionCard({ action, onResolve, compact = false, showRequest = false }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const resolve = async (approve) => {
    setBusy(true);
    try {
      await onResolve(action.id, approve);
    } finally {
      setBusy(false);
    }
  };

  const summary = resultSummary(action);
  const candidates = action.result?.candidates;

  return (
    <div className={`action action-${STATUS[action.status]?.cls ?? 'muted'}${compact ? ' action-compact' : ''}`}>
      <div className="action-head">
        <code className="tool-name">{action.tool}</code>
        <StatusBadge status={action.status} />
        <span className="action-source">
          {action.source === 'ui' ? 'manual' : action.source === 'mcp' ? 'MCP client' : action.provider === 'local' ? 'offline engine' : 'Claude'}
        </span>
      </div>
      {showRequest && action.request && action.source !== 'ui' && <p className="action-request">“{action.request}”</p>}
      {action.status === 'error' ? (
        <p className="action-msg err-text">{action.error}</p>
      ) : (
        action.message && <p className="action-msg">{action.message}</p>
      )}
      {summary && action.status === 'success' && <p className="action-result">{summary}</p>}
      {candidates?.length > 0 && (
        <ul className="candidates">
          {candidates.map((c) => (
            <li key={c.id}>
              {c.title} <span className="dim">({c.status}{c.dueDate ? `, due ${c.dueDate}` : ''})</span>
            </li>
          ))}
        </ul>
      )}
      {action.status === 'awaiting_confirmation' && onResolve && (
        <div className="confirm-row">
          <button className="btn btn-danger" disabled={busy} onClick={() => resolve(true)}>
            Confirm
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => resolve(false)}>
            Cancel
          </button>
        </div>
      )}
      <button className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide' : 'Show'} arguments
      </button>
      {open && <pre className="args">{JSON.stringify(action.args, null, 2)}</pre>}
    </div>
  );
}
