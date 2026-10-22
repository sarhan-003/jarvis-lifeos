import { useCallback, useEffect, useState } from 'react';
import { api, localToday } from './api.js';
import { useSpeechOutput } from './useSpeech.js';
import Chat from './components/Chat.jsx';
import TasksView, { TaskList, sortTasks } from './components/Tasks.jsx';
import PlansView, { PlanTimeline } from './components/Plans.jsx';
import ActionCard from './components/ActionCard.jsx';
import McpServerView from './components/McpServer.jsx';

const NAV = [
  { id: 'assistant', label: 'Alexa+ simulator', short: 'Assistant', icon: '◉' },
  { id: 'tasks', label: 'Tasks', icon: '☑' },
  { id: 'plans', label: 'Study plan', icon: '▤' },
  { id: 'mcp', label: 'MCP server', short: 'MCP', icon: '⧉' },
  { id: 'activity', label: 'Activity', icon: '⚡' },
];

const HISTORY_KEY = 'jarvis.chat';
const loadHistory = () => {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) ?? [];
  } catch {
    return [];
  }
};

let nextId = Date.now();
const uid = () => String((nextId += 1));

export default function App() {
  const [view, setView] = useState('assistant');
  const [health, setHealth] = useState(null);
  const [offline, setOffline] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [plans, setPlans] = useState([]);
  const [actions, setActions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [messages, setMessages] = useState(loadHistory);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const tts = useSpeechOutput();
  const today = localToday();

  const refresh = useCallback(async () => {
    try {
      const [t, p, a, s] = await Promise.all([api.tasks(), api.plans(), api.actions(), api.summary()]);
      setTasks(t.tasks);
      setPlans(p.plans);
      setActions(a.actions);
      setSummary(s.summary);
      setOffline(null);
    } catch (err) {
      setOffline(err.message);
    }
  }, []);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((err) => setOffline(err.message));
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-60)));
    } catch {
      /* storage unavailable: history lives in memory only */
    }
  }, [messages]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const send = useCallback(
    async (text) => {
      const history = messages.slice(-10).map(({ role, text: t }) => ({ role, text: t }));
      setMessages((m) => [...m, { id: uid(), role: 'user', text }]);
      setSending(true);
      try {
        const res = await api.chat(text, history);
        setMessages((m) => [
          ...m,
          { id: uid(), role: 'assistant', text: res.reply, actions: res.actions, provider: res.provider?.label, notice: res.notice, mcp: res.mcp },
        ]);
        tts.speak(res.reply);
      } catch (err) {
        setMessages((m) => [...m, { id: uid(), role: 'assistant', text: err.message, error: true }]);
      } finally {
        setSending(false);
        refresh();
      }
    },
    [messages, refresh, tts],
  );

  const resolveAction = useCallback(
    async (id, approve) => {
      try {
        const { action } = approve ? await api.confirm(id) : await api.cancel(id);
        setMessages((m) => m.map((msg) => (msg.actions ? { ...msg, actions: msg.actions.map((a) => (a.id === id ? action : a)) } : msg)));
        const note = action.status === 'error' ? action.error : action.message;
        setToast({ kind: action.status === 'error' ? 'err' : 'ok', text: note });
        tts.speak(note);
      } catch (err) {
        setToast({ kind: 'err', text: err.message });
      }
      refresh();
    },
    [refresh, tts],
  );

  // Manual task edits: returns an error string for the form, or null.
  const mutate = useCallback(
    async (fn, successText) => {
      try {
        const { action } = await fn();
        if (action.status === 'error') return action.error;
        setToast({ kind: 'ok', text: successText ?? action.message });
        return null;
      } catch (err) {
        return err.message;
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  const handlers = {
    today,
    onCreate: (fields) => mutate(() => api.createTask(fields)),
    onUpdate: (id, fields) => mutate(() => api.updateTask(id, fields)),
    onComplete: async (id) => {
      const err = await mutate(() => api.completeTask(id));
      if (err) setToast({ kind: 'err', text: err });
    },
    onDelete: (task) => setPendingDelete(task),
  };

  const confirmDelete = async () => {
    const task = pendingDelete;
    setPendingDelete(null);
    const err = await mutate(() => api.deleteTask(task.id));
    if (err) setToast({ kind: 'err', text: err });
  };

  const pending = sortTasks(tasks.filter((t) => t.status === 'pending'));
  const focusPlan = plans.find((p) => p.date === today) ?? plans.find((p) => p.date > today);
  const awaiting = actions.filter((a) => a.status === 'awaiting_confirmation').length;

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <div className="brand-name">Jarvis LifeOS</div>
            <div className="brand-sub">for Alexa+ · MCP</div>
          </div>
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item${view === n.id ? ' active' : ''}`} onClick={() => setView(n.id)} aria-label={n.label} aria-current={view === n.id ? 'page' : undefined}>
              <span className="nav-icon" aria-hidden="true">
                {n.icon}
              </span>
              <span className="nav-label">
                <span className="label-full">{n.label}</span>
                <span className="label-short">{n.short ?? n.label}</span>
              </span>
              {n.id === 'tasks' && pending.length > 0 && <span className="nav-count">{pending.length}</span>}
              {n.id === 'activity' && awaiting > 0 && <span className="nav-count warn">{awaiting}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={`status-dot ${offline ? 'down' : 'up'}`} />
          <div className="small">
            <div>{offline ? 'Server offline' : health?.ai?.label ?? 'Connecting…'}</div>
            {health?.ai?.warning ? <div className="warn-text">{health.ai.warning}</div> : <div className="dim">Simulated Alexa+ · tools via MCP</div>}
          </div>
        </div>
      </aside>

      <main id="main" className="main">
        <header className="topbar">
          <div>
            <h1>{NAV.find((n) => n.id === view).label}</h1>
            <p className="dim small">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              {summary && ` · ${summary.counts.pending} pending · ${summary.counts.dueToday} due today${summary.counts.overdue ? ` · ${summary.counts.overdue} overdue` : ''}`}
            </p>
          </div>
          {messages.length > 0 && view === 'assistant' && (
            <button className="btn btn-ghost" onClick={() => setMessages([])}>
              Clear chat
            </button>
          )}
        </header>

        {offline && (
          <div className="alert" role="alert">
            {offline}{' '}
            <button className="link-btn" onClick={refresh}>
              Retry
            </button>
          </div>
        )}

        {view === 'assistant' && (
          <div className="dashboard">
            <Chat messages={messages} sending={sending} onSend={send} onResolve={resolveAction} tts={tts} engine={health?.ai?.label} />
            <div className="side-col">
              {summary && (
                <section className="panel stats" aria-label="Today at a glance">
                  <div className="stat">
                    <b>{summary.counts.dueToday}</b>
                    <span>due today</span>
                  </div>
                  <div className="stat">
                    <b>{summary.counts.pending}</b>
                    <span>pending</span>
                  </div>
                  <div className="stat">
                    <b>{summary.counts.completedToday}</b>
                    <span>done today</span>
                  </div>
                  <div className={`stat${summary.counts.overdue ? ' stat-warn' : ''}`}>
                    <b>{summary.counts.overdue}</b>
                    <span>overdue</span>
                  </div>
                </section>
              )}
              <section className="panel">
                <div className="panel-head">
                  <h2>Pending tasks</h2>
                  <button className="link-btn" onClick={() => setView('tasks')}>
                    Manage
                  </button>
                </div>
                <TaskList tasks={pending.slice(0, 6)} {...handlers} onUpdate={null} onDelete={null} empty="No pending tasks. Ask Jarvis to add one." />
                {pending.length > 6 && <p className="dim small">+{pending.length - 6} more</p>}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>{focusPlan?.date === today ? "Today's study plan" : 'Next study plan'}</h2>
                  <button className="link-btn" onClick={() => setView('plans')}>
                    All plans
                  </button>
                </div>
                {focusPlan ? <PlanTimeline plan={focusPlan} /> : <p className="empty-small">No upcoming study plan. Ask Jarvis to create one.</p>}
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Recent actions</h2>
                  <button className="link-btn" onClick={() => setView('activity')}>
                    View all
                  </button>
                </div>
                {actions.length ? (
                  actions.slice(0, 4).map((a) => <ActionCard key={a.id} action={a} onResolve={resolveAction} compact />)
                ) : (
                  <p className="empty-small">Tool executions will appear here.</p>
                )}
              </section>
            </div>
          </div>
        )}

        {view === 'tasks' && <TasksView tasks={tasks} {...handlers} />}
        {view === 'plans' && <PlansView plans={plans} today={today} />}
        {view === 'mcp' && <McpServerView />}
        {view === 'activity' && (
          <section className="panel">
            <div className="panel-head">
              <h2>Tool execution log</h2>
              <span className="dim small">Every tool call, its arguments and its real result</span>
            </div>
            {actions.length ? (
              <div className="activity-grid">
                {actions.map((a) => (
                  <div key={a.id}>
                    <div className="dim small">{new Date(a.createdAt).toLocaleString()}</div>
                    <ActionCard action={a} onResolve={resolveAction} showRequest />
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-small">No actions yet.</p>
            )}
          </section>
        )}
      </main>

      {pendingDelete && (
        <div className="modal-backdrop" role="presentation" onClick={() => setPendingDelete(null)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="del-title">Delete task?</h2>
            <p>“{pendingDelete.title}” will be permanently removed.</p>
            <div className="confirm-row">
              <button className="btn btn-danger" onClick={confirmDelete} autoFocus>
                Delete
              </button>
              <button className="btn btn-ghost" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
