// The tool catalogue shared by every agent (Claude and the offline engine)
// and by the REST API. Each tool validates its arguments with zod, performs a
// real operation against the store, and returns { result, message }.
import { z } from 'zod';
import { isIsoDate, toMinutes, fromMinutes, weekdayOf, addDays } from './dates.js';

export class ToolError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

const isoDate = z.string().refine(isIsoDate, 'must be a date in YYYY-MM-DD format');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24h time like 09:00');
const priority = z.enum(['low', 'medium', 'high']);
const taskRef = {
  taskId: z.string().min(1).optional().describe('Exact task id, when known'),
  taskQuery: z
    .string()
    .min(1)
    .optional()
    .describe('Words from the task title to find it, e.g. "graph revision"'),
};
const session = z.object({
  topic: z.string().trim().min(1).max(120),
  minutes: z.number().int().min(10).max(480),
  notes: z.string().max(300).optional(),
});

// ---------- task matching ----------

const STOP = new Set(['the', 'a', 'an', 'my', 'to', 'task', 'for', 'of', 'on', 'and', 'as', 'is']);
const stem = (w) => w.replace(/(ions|ion|ing|ed|es|s|e)$/, '');
const words = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);

export function findTasks(store, query, status) {
  const q = words(query);
  if (!q.length) return [];
  const scored = store
    .listTasks({ status: status ?? 'all' })
    .map((task) => {
      const t = words(task.title);
      const hits = q.filter((w) => t.some((tw) => tw === w || (w.length > 3 && tw.startsWith(w)) || (tw.length > 3 && w.startsWith(tw))));
      return { task, score: hits.length / q.length };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const best = scored[0].score;
  return scored.filter((s) => s.score === best).map((s) => s.task);
}

function resolveTask(store, { taskId, taskQuery }, preferStatus) {
  if (taskId) {
    const task = store.getTask(taskId);
    if (!task) throw new ToolError(`No task with id ${taskId}.`);
    return task;
  }
  if (!taskQuery) throw new ToolError('Provide taskId or taskQuery to identify the task.');
  let matches = preferStatus ? findTasks(store, taskQuery, preferStatus) : [];
  if (!matches.length) matches = findTasks(store, taskQuery);
  if (!matches.length) throw new ToolError(`I couldn't find a task matching "${taskQuery}".`);
  if (matches.length > 1) {
    throw new ToolError(`"${taskQuery}" matches ${matches.length} tasks. Which one did you mean?`, {
      candidates: matches.map(({ id, title, dueDate, status }) => ({ id, title, dueDate, status })),
    });
  }
  return matches[0];
}

// ---------- study plan scheduling ----------

// Turn requested sessions into a timed schedule. Long sessions are split into
// focus blocks of at most `maxBlockMinutes` with breaks between all blocks.
export function buildSchedule({ startTime, sessions, breakMinutes, maxBlockMinutes }) {
  const blocks = [];
  let cursor = toMinutes(startTime);
  const studyChunks = [];
  for (const s of sessions) {
    let remaining = s.minutes;
    const parts = Math.ceil(s.minutes / maxBlockMinutes);
    let part = 1;
    while (remaining > 0) {
      const len = Math.min(maxBlockMinutes, remaining);
      studyChunks.push({ topic: s.topic, notes: s.notes ?? '', minutes: len, part, parts });
      remaining -= len;
      part += 1;
    }
  }
  studyChunks.forEach((chunk, i) => {
    blocks.push({
      type: 'study',
      topic: chunk.topic,
      label: chunk.parts > 1 ? `${chunk.topic} (part ${chunk.part}/${chunk.parts})` : chunk.topic,
      notes: chunk.notes,
      start: fromMinutes(cursor),
      end: fromMinutes(cursor + chunk.minutes),
      minutes: chunk.minutes,
    });
    cursor += chunk.minutes;
    if (i < studyChunks.length - 1 && breakMinutes > 0) {
      blocks.push({ type: 'break', label: 'Break', start: fromMinutes(cursor), end: fromMinutes(cursor + breakMinutes), minutes: breakMinutes });
      cursor += breakMinutes;
    }
  });
  if (cursor > 24 * 60) {
    throw new ToolError(`This plan would run past midnight (ends at ${fromMinutes(cursor - 24 * 60)} next day). Start earlier or shorten sessions.`);
  }
  const studyMinutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  return { blocks, studyMinutes, endTime: fromMinutes(cursor) };
}

function planPayload(fields) {
  const schedule = buildSchedule(fields);
  return {
    date: fields.date,
    title: fields.title || `Study plan · ${capitalize(weekdayOf(fields.date))} ${fields.date}`,
    startTime: fields.startTime,
    breakMinutes: fields.breakMinutes,
    maxBlockMinutes: fields.maxBlockMinutes,
    sessions: fields.sessions,
    ...schedule,
  };
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtMinutes = (m) => (m % 60 === 0 ? `${m / 60}h` : m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

// ---------- tool definitions ----------

export const TOOLS = {
  createTask: {
    description: 'Create a new task (to-do) and save it. Use for "remind me to", "add a task", "I need to ...".',
    schema: z.object({
      title: z.string().trim().min(1).max(200).describe('Short task title, e.g. "Revise binary trees"'),
      dueDate: isoDate.optional().describe('Due date YYYY-MM-DD'),
      priority: priority.optional().describe('Defaults to medium'),
      notes: z.string().max(1000).optional(),
    }),
    async run(args, { store }) {
      const task = await store.insertTask(args);
      return { result: { task }, message: `Saved task "${task.title}"${task.dueDate ? ` due ${task.dueDate}` : ''}.` };
    },
  },

  listTasks: {
    description: 'List saved tasks from the database. Filter by status (pending, completed, all) and optionally by due date.',
    schema: z.object({
      status: z.enum(['pending', 'completed', 'all']).optional().describe('Defaults to pending'),
      dueDate: isoDate.optional(),
    }),
    async run({ status = 'pending', dueDate }, { store }) {
      const tasks = store.listTasks({ status, dueDate });
      const scope = `${status === 'all' ? '' : `${status} `}task${tasks.length === 1 ? '' : 's'}${dueDate ? ` due ${dueDate}` : ''}`;
      const message = tasks.length
        ? `You have ${tasks.length} ${scope}: ${tasks.map((t) => t.title).join('; ')}.`
        : `You have no ${scope}.`;
      return { result: { status, dueDate: dueDate ?? null, count: tasks.length, tasks }, message };
    },
  },

  updateTask: {
    description: 'Edit an existing task: rename it, change its due date, priority or notes. Identify it by taskId or taskQuery.',
    schema: z
      .object({
        ...taskRef,
        title: z.string().trim().min(1).max(200).optional(),
        dueDate: isoDate.nullable().optional().describe('New due date, or null to clear it'),
        priority: priority.optional(),
        notes: z.string().max(1000).optional(),
      })
      .refine((a) => a.taskId || a.taskQuery, 'Provide taskId or taskQuery')
      .refine((a) => ['title', 'dueDate', 'priority', 'notes'].some((k) => a[k] !== undefined), 'Nothing to update'),
    async run(args, { store }) {
      const task = resolveTask(store, args, 'pending');
      const patch = {};
      for (const k of ['title', 'dueDate', 'priority', 'notes']) {
        if (args[k] !== undefined && args[k] !== task[k]) patch[k] = args[k];
      }
      if (!Object.keys(patch).length) {
        return { result: { task, changes: [] }, message: `"${task.title}" already has those values; nothing changed.` };
      }
      const before = { ...task };
      const updated = await store.patchTask(task.id, patch);
      const changes = Object.keys(patch).map((k) => `${k}: ${before[k] ?? 'none'} → ${updated[k] ?? 'none'}`);
      return { result: { task: updated, changes }, message: `Updated "${updated.title}" (${changes.join(', ')}).` };
    },
  },

  completeTask: {
    description: 'Mark a task as completed. Identify it by taskId or by words from its title (taskQuery).',
    schema: z.object({ ...taskRef }).refine((a) => a.taskId || a.taskQuery, 'Provide taskId or taskQuery'),
    async run(args, { store }) {
      const task = resolveTask(store, args, 'pending');
      if (task.status === 'completed') {
        return { result: { task, alreadyCompleted: true }, message: `"${task.title}" was already completed.` };
      }
      const updated = await store.patchTask(task.id, { status: 'completed', completedAt: new Date().toISOString() });
      return { result: { task: updated }, message: `Marked "${updated.title}" as complete.` };
    },
  },

  deleteTask: {
    description: 'Permanently delete a task. Destructive: the user must confirm in the UI before it runs.',
    destructive: true,
    schema: z.object({ ...taskRef }).refine((a) => a.taskId || a.taskQuery, 'Provide taskId or taskQuery'),
    confirmation(args, { store }) {
      const task = resolveTask(store, args);
      return { prompt: `Delete task "${task.title}"? This cannot be undone.`, args: { taskId: task.id } };
    },
    async run(args, { store }) {
      const task = resolveTask(store, args);
      await store.removeTask(task.id);
      return { result: { deleted: task }, message: `Deleted task "${task.title}".` };
    },
  },

  generateStudyPlan: {
    description:
      'Create and save a timed study schedule for one day from a list of topics and durations. ' +
      'Long topics are split into focus blocks with breaks. Replacing an existing plan for that date requires user confirmation.',
    schema: z.object({
      date: isoDate.describe('Day of the plan, YYYY-MM-DD'),
      sessions: z.array(session).min(1).max(12).describe('Topics in order, with minutes for each'),
      startTime: hhmm.optional().describe('Start time, 24h HH:MM. Defaults to 09:00'),
      breakMinutes: z.number().int().min(0).max(60).optional().describe('Break between blocks. Defaults to 10'),
      maxBlockMinutes: z.number().int().min(20).max(180).optional().describe('Longest single focus block. Defaults to 60'),
      title: z.string().max(120).optional(),
    }),
    defaults: { startTime: '09:00', breakMinutes: 10, maxBlockMinutes: 60 },
    confirmation(args, { store }) {
      const existing = store.getPlanByDate(args.date);
      if (!existing) return null;
      return { prompt: `A study plan for ${args.date} already exists (${fmtMinutes(existing.studyMinutes)} of study). Replace it?`, args };
    },
    async run(args, { store }) {
      const plan = await store.upsertPlan(planPayload({ ...this.defaults, ...args }));
      return {
        result: { plan },
        message: `Saved a ${fmtMinutes(plan.studyMinutes)} study plan for ${plan.date}, ${plan.startTime}–${plan.endTime}: ${plan.sessions
          .map((s) => `${s.topic} (${fmtMinutes(s.minutes)})`)
          .join(', ')}.`,
      };
    },
  },

  updateStudyPlan: {
    description:
      'Modify a saved study plan (by planId or date): add topics, remove topics, change a topic\'s duration, ' +
      'move the start time or change break length. The schedule is recalculated and saved.',
    schema: z
      .object({
        planId: z.string().optional(),
        date: isoDate.optional().describe('Date of the plan to modify'),
        startTime: hhmm.optional(),
        breakMinutes: z.number().int().min(0).max(60).optional(),
        addSessions: z.array(session).max(12).optional().describe('Topics to append'),
        removeTopics: z.array(z.string().min(1)).max(12).optional().describe('Topics to remove (matched by name)'),
        changeSessions: z
          .array(z.object({ topic: z.string().min(1), minutes: z.number().int().min(10).max(480) }))
          .max(12)
          .optional()
          .describe('Set a new duration for existing topics'),
      })
      .refine((a) => a.planId || a.date, 'Provide planId or date'),
    async run(args, { store }) {
      const plan = args.planId ? store.getPlan(args.planId) : store.getPlanByDate(args.date);
      if (!plan) throw new ToolError(`There is no study plan for ${args.date ?? args.planId}. Create one first.`);
      const matchTopic = (a, b) => {
        const wa = words(a);
        const wb = words(b);
        return wa.length > 0 && wa.every((w) => wb.includes(w));
      };
      let sessions = plan.sessions.map((s) => ({ ...s }));
      const changes = [];
      for (const topic of args.removeTopics ?? []) {
        const before = sessions.length;
        sessions = sessions.filter((s) => !matchTopic(topic, s.topic));
        if (sessions.length === before) throw new ToolError(`The plan has no topic matching "${topic}".`);
        changes.push(`removed ${topic}`);
      }
      for (const change of args.changeSessions ?? []) {
        const target = sessions.find((s) => matchTopic(change.topic, s.topic));
        if (!target) throw new ToolError(`The plan has no topic matching "${change.topic}".`);
        changes.push(`${target.topic}: ${fmtMinutes(target.minutes)} → ${fmtMinutes(change.minutes)}`);
        target.minutes = change.minutes;
      }
      for (const add of args.addSessions ?? []) {
        sessions.push(add);
        changes.push(`added ${add.topic} (${fmtMinutes(add.minutes)})`);
      }
      if (args.startTime) changes.push(`start ${plan.startTime} → ${args.startTime}`);
      if (args.breakMinutes !== undefined) changes.push(`breaks ${plan.breakMinutes}m → ${args.breakMinutes}m`);
      if (!changes.length) throw new ToolError('No changes were requested for the study plan.');
      if (!sessions.length) throw new ToolError('That would remove every topic from the plan.');
      const updated = await store.upsertPlan(
        planPayload({
          date: plan.date,
          title: plan.title,
          startTime: args.startTime ?? plan.startTime,
          breakMinutes: args.breakMinutes ?? plan.breakMinutes,
          maxBlockMinutes: plan.maxBlockMinutes,
          sessions,
        }),
      );
      return {
        result: { plan: updated, changes },
        message: `Updated the ${updated.date} plan (${changes.join('; ')}). It now runs ${updated.startTime}–${updated.endTime}.`,
      };
    },
  },

  getDailySummary: {
    description: "Summarize a day: tasks due, overdue tasks, tasks completed that day, and that day's study plan.",
    schema: z.object({ date: isoDate.optional().describe('Defaults to today') }),
    async run({ date }, { store, today }) {
      const day = date ?? today;
      const all = store.listTasks();
      const dueToday = all.filter((t) => t.status === 'pending' && t.dueDate === day);
      const overdue = all.filter((t) => t.status === 'pending' && t.dueDate && t.dueDate < day);
      const completedToday = all.filter((t) => t.status === 'completed' && t.completedAt && localDay(t.completedAt) === day);
      const pending = all.filter((t) => t.status === 'pending');
      const highPriority = pending.filter((t) => t.priority === 'high');
      const plan = store.getPlanByDate(day);
      const tomorrowPlan = store.getPlanByDate(addDays(day, 1));
      const parts = [
        `${capitalize(weekdayOf(day))} ${day}:`,
        `${dueToday.length} task${dueToday.length === 1 ? '' : 's'} due`,
        `${completedToday.length} completed`,
        `${overdue.length} overdue`,
      ];
      let message = `${parts[0]} ${parts.slice(1).join(', ')}.`;
      message += plan ? ` Study plan: ${fmtMinutes(plan.studyMinutes)} from ${plan.startTime} to ${plan.endTime}.` : ' No study plan for this day.';
      if (highPriority.length) message += ` High priority: ${highPriority.map((t) => t.title).join('; ')}.`;
      return {
        result: {
          date: day,
          counts: { dueToday: dueToday.length, overdue: overdue.length, completedToday: completedToday.length, pending: pending.length },
          dueToday,
          overdue,
          completedToday,
          highPriority,
          plan,
          tomorrowPlan,
        },
        message,
      };
    },
  },
};

// completedAt is an ISO timestamp; compare by the server's local calendar day.
function localDay(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// JSON Schemas for LLM tool definitions, generated from the zod schemas so the
// model and the validator can never disagree.
export function toolJsonSchemas() {
  return Object.entries(TOOLS).map(([name, tool]) => {
    const { $schema, ...input_schema } = z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' });
    return { name, description: tool.description, input_schema };
  });
}
