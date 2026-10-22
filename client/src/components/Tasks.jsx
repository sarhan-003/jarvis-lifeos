// Task list with inline add, edit, complete and delete. All edits go through
// the same validated backend tools the assistant uses.
import { useState } from 'react';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function TaskRow({ task, onComplete, onUpdate, onDelete, today }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: task.title, dueDate: task.dueDate ?? '', priority: task.priority });
  const [error, setError] = useState(null);
  const overdue = task.status === 'pending' && task.dueDate && task.dueDate < today;

  const save = async (e) => {
    e.preventDefault();
    const err = await onUpdate(task.id, { title: form.title, dueDate: form.dueDate || null, priority: form.priority });
    if (err) setError(err);
    else {
      setError(null);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <li className="task editing">
        <form onSubmit={save} className="task-edit">
          <input aria-label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
          <input aria-label="Due date" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <select aria-label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button className="btn btn-primary">Save</button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
          {error && <p className="err-text small full">{error}</p>}
        </form>
      </li>
    );
  }

  return (
    <li className={`task task-${task.status}`}>
      <button
        className="check"
        onClick={() => onComplete(task.id)}
        disabled={task.status === 'completed'}
        aria-label={task.status === 'completed' ? `${task.title} completed` : `Complete ${task.title}`}
      >
        {task.status === 'completed' ? '✓' : ''}
      </button>
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span className={`prio prio-${task.priority}`}>{task.priority}</span>
          {task.dueDate && <span className={overdue ? 'err-text' : ''}>{overdue ? 'Overdue · ' : 'Due '}{task.dueDate}</span>}
          {task.completedAt && <span>Done {task.completedAt.slice(0, 10)}</span>}
        </div>
      </div>
      {onUpdate && task.status === 'pending' && (
        <button className="icon-btn" onClick={() => setEditing(true)} aria-label={`Edit ${task.title}`}>
          ✎
        </button>
      )}
      {onDelete && (
        <button className="icon-btn danger" onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`}>
          🗑
        </button>
      )}
    </li>
  );
}

export function sortTasks(tasks) {
  return [...tasks].sort(
    (a, b) =>
      (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}

export function TaskList({ tasks, empty, ...handlers }) {
  if (!tasks.length) return <p className="empty-small">{empty}</p>;
  return (
    <ul className="tasks">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} {...handlers} />
      ))}
    </ul>
  );
}

export default function TasksView({ tasks, today, onCreate, onComplete, onUpdate, onDelete }) {
  const [filter, setFilter] = useState('pending');
  const [form, setForm] = useState({ title: '', dueDate: '', priority: 'medium' });
  const [error, setError] = useState(null);

  const shown = sortTasks(tasks.filter((t) => filter === 'all' || t.status === filter));
  const counts = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    all: tasks.length,
  };

  const add = async (e) => {
    e.preventDefault();
    const err = await onCreate({ title: form.title, dueDate: form.dueDate || undefined, priority: form.priority });
    if (err) setError(err);
    else {
      setError(null);
      setForm({ title: '', dueDate: '', priority: 'medium' });
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Tasks</h2>
        <div className="tabs" role="tablist">
          {['pending', 'completed', 'all'].map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f} <span className="count">{counts[f]}</span>
            </button>
          ))}
        </div>
      </div>
      <form className="task-add" onSubmit={add}>
        <input aria-label="New task title" placeholder="Add a task…" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} />
        <input aria-label="Due date" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        <select aria-label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button className="btn btn-primary" disabled={!form.title.trim()}>
          Add
        </button>
      </form>
      {error && <p className="err-text small">{error}</p>}
      <TaskList
        tasks={shown}
        today={today}
        onComplete={onComplete}
        onUpdate={onUpdate}
        onDelete={onDelete}
        empty={filter === 'completed' ? 'Nothing completed yet.' : 'No tasks here. Add one above or ask Jarvis.'}
      />
    </section>
  );
}
