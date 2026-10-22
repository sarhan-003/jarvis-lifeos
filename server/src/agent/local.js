// Offline intent engine: a deterministic, rule-based parser that turns common
// phrasings into the same tool calls Claude would make. It lets the app run
// and be tested without an API key. It understands far fewer phrasings than an
// LLM, and the UI labels responses from it as "offline engine".
import { resolveDate } from '../dates.js';

const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5 };
const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
const DATE_RE = new RegExp(
  `\\b(?:(?:due|by|on|for)\\s+)?(today|tonight|tomorrow|day after tomorrow|yesterday|in \\d+ days?|next week|(?:next |this )?${WEEKDAY}|\\d{4}-\\d{2}-\\d{2})(?:'s)?\\b`,
  'i',
);

function extractDate(text, today) {
  const m = text.match(DATE_RE);
  if (!m) return { date: null, rest: text };
  const date = resolveDate(m[1], today);
  return { date, rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim() };
}

function extractPriority(text) {
  const m = text.match(/\b(?:with\s+)?(?:(high|low|medium|urgent|important)\s+priority|priority\s+(?:to\s+)?(high|low|medium))\b|\b(urgent|important)\b/i);
  if (!m) return { priority: null, rest: text };
  const word = (m[1] || m[2] || m[3]).toLowerCase();
  const priority = word === 'urgent' || word === 'important' ? 'high' : word;
  return { priority, rest: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim() };
}

function parseTime(text) {
  const m = text.match(/\b(?:start(?:ing)?\s+(?:at\s+)?|from\s+|at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (!ampm && h >= 1 && h <= 6) h += 12; // "at 3" while studying almost always means 3pm
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const DURATION = '(\\d+(?:\\.\\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|half an?|an? half)\\s*(hours?|hrs?|h|minutes?|mins?|m)\\b';

function toMinutes(qty, unit) {
  let n = NUM_WORDS[qty.toLowerCase().split(' ')[0]] ?? Number(qty);
  if (/half/.test(qty)) n = 0.5;
  return Math.round(/^h/i.test(unit) ? n * 60 : n);
}

const cleanTopic = (s) =>
  s
    .replace(/\b(tomorrow|today|tonight|study plan|plan|please|session|sessions)\b/gi, '')
    .replace(/^(of|on|for|studying|doing)\s+/i, '')
    .replace(/[.,;!?]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

// "two hours of graph algorithms and 45 minutes of DP" -> sessions
function parseSessions(text) {
  const re = new RegExp(`${DURATION}\\s+(?:of\\s+|on\\s+|for\\s+)?([a-z][a-z0-9 '\\-+#/]*?)(?=\\s*(?:,|;|\\band\\b|\\bthen\\b|\\bfollowed by\\b|\\bstart|\\bfrom\\b|\\bat\\b|\\bwith\\b|\\bfor (?:today|tomorrow)|$))`, 'gi');
  const sessions = [];
  for (const m of text.matchAll(re)) {
    const topic = cleanTopic(m[3]);
    const minutes = toMinutes(m[1], m[2]);
    if (topic && minutes >= 10) sessions.push({ topic: titleCase(topic), minutes });
  }
  return sessions;
}

const titleCase = (s) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(And|Of|The|To|In|On|For)\b/g, (w) => w.toLowerCase());
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function pickPlanDate(date, store, today) {
  if (date) return date;
  const plans = store.listPlans();
  const upcoming = plans.find((p) => p.date >= today);
  return upcoming?.date ?? plans.at(-1)?.date ?? today;
}

export function parseIntent(input, { store, today }) {
  const text = input.trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();

  // Daily summary
  if (/\b(summary|summarize|summarise|brief(ing)?|how('s| is| does) my day|what('s| is) on (my plate|today|tomorrow)|my day look)\b/.test(lower)) {
    const { date } = extractDate(text, today);
    return [{ tool: 'getDailySummary', args: date ? { date } : {} }];
  }

  // Modify an existing study plan
  const mentionsPlan = /\b(plan|schedule)\b/.test(lower);
  const createsPlan = /\b(create|make|generate|build|prepare|plan out|new)\b.*\b(study plan|study schedule|schedule|plan)\b|\bplan (my|a) study\b|\bstudy plan for\b/.test(lower);
  if (mentionsPlan && !createsPlan) {
    const { date: explicitDate, rest } = extractDate(text, today);
    const date = pickPlanDate(explicitDate, store, today);
    const args = { date };
    const addM = rest.match(/\badd\b\s+(.*?)\s+(?:to|into|in)\b/i);
    const removeM = rest.match(/\b(?:remove|drop|delete|skip)\s+(.*?)\s+(?:from|in|out of)\b/i);
    const changeM = rest.match(/\b(?:change|set|make|extend|shorten|reduce|increase)\s+(.*?)\s+(?:to|into)\s+(.+)$/i);
    const startTime = /\b(start|begin|move|shift)\b/i.test(rest) ? parseTime(rest) : null;
    const breakM = rest.match(/\bbreaks?\b.*?\b(\d+)\s*(?:minutes?|mins?|m)\b/i) || rest.match(/\b(\d+)\s*(?:minutes?|mins?|m)\s+breaks?\b/i);
    if (addM) {
      const sessions = parseSessions(addM[1]);
      if (sessions.length) args.addSessions = sessions;
    }
    if (removeM) args.removeTopics = removeM[1].split(/\s*(?:,|\band\b)\s*/).map(cleanTopic).filter(Boolean);
    if (changeM && !breakM) {
      const dur = changeM[2].match(new RegExp(DURATION, 'i'));
      if (dur) args.changeSessions = [{ topic: cleanTopic(changeM[1].replace(/\b(the|my)\b/gi, '')), minutes: toMinutes(dur[1], dur[2]) }];
    }
    if (startTime) args.startTime = startTime;
    if (breakM) args.breakMinutes = Number(breakM[1]);
    if (Object.keys(args).length > 1) return [{ tool: 'updateStudyPlan', args }];
  }

  // Create a study plan
  if (createsPlan || /\bstudy\b.*\b(hours?|minutes?)\b/.test(lower)) {
    const { date } = extractDate(text, today);
    const planDate = date ?? today;
    let sessions = parseSessions(text);
    let note = null;
    if (!sessions.length) {
      // No topics given: build the plan from pending tasks due by that day.
      const pending = store.listTasks({ status: 'pending' }).filter((t) => !t.dueDate || t.dueDate <= planDate);
      sessions = pending.slice(0, 6).map((t) => ({ topic: t.title, minutes: t.priority === 'high' ? 60 : 45 }));
      note = sessions.length ? 'No topics were given, so I built the plan from your pending tasks.' : null;
    }
    if (!sessions.length) {
      return { reply: 'Which topics should the study plan cover? For example: "two hours of graph algorithms and one hour of dynamic programming".' };
    }
    const args = { date: planDate, sessions };
    const startTime = parseTime(text);
    if (startTime) args.startTime = startTime;
    return [{ tool: 'generateStudyPlan', args, note }];
  }

  // Complete a task
  const completeM =
    text.match(/^(?:please\s+)?(?:mark|tick off|check off|set)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:as\s+)?(?:complete|completed|done|finished)\.?$/i) ||
    text.match(/^(?:please\s+)?(?:complete|finish|tick off|check off|close)\s+(?:the\s+)?(?:task\s+)?(.+?)\.?$/i) ||
    text.match(/^i(?:'ve| have)?\s+(?:finished|completed|done with|done)\s+(?:the\s+)?(?:task\s+)?(.+?)\.?$/i);
  if (completeM) return [{ tool: 'completeTask', args: { taskQuery: completeM[1] } }];

  // Delete a task (requires confirmation)
  const deleteM = text.match(/^(?:please\s+)?(?:delete|remove|get rid of)\s+(?:the\s+)?(?:task\s+)?(.+?)(?:\s+task)?\.?$/i);
  if (deleteM) return [{ tool: 'deleteTask', args: { taskQuery: deleteM[1] } }];

  // List tasks
  if (/\b(show|list|what are|what's|whats|display|see|view|any|get)\b.*\b(tasks?|to-?dos?|to do list)\b|^(my )?(pending |completed )?tasks\??$/i.test(lower)) {
    const status = /\b(completed|done|finished)\b/.test(lower) ? 'completed' : /\ball\b/.test(lower) ? 'all' : 'pending';
    const { date } = extractDate(text, today);
    return [{ tool: 'listTasks', args: date ? { status, dueDate: date } : { status } }];
  }

  // Update a task
  const renameM = text.match(/^(?:rename|retitle)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+to\s+(.+?)\.?$/i);
  if (renameM) return [{ tool: 'updateTask', args: { taskQuery: renameM[1], title: sentence(renameM[2]) } }];
  const prioM =
    text.match(/^(?:set|change|make)\s+(?:the\s+)?(?:task\s+)?(.+?)(?:'s)?\s+priority\s+(?:to\s+)?(high|medium|low)\.?$/i) ||
    text.match(/^(?:make|mark|set)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:as\s+|to\s+)?(high|medium|low)\s+priority\.?$/i);
  if (prioM) return [{ tool: 'updateTask', args: { taskQuery: prioM[1], priority: prioM[2].toLowerCase() } }];
  const moveM = text.match(/^(?:move|reschedule|push|postpone|change)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:to|until|for)\s+(.+?)\.?$/i);
  if (moveM) {
    const date = resolveDate(moveM[2].replace(/^(?:due\s+)?/i, ''), today);
    if (date) return [{ tool: 'updateTask', args: { taskQuery: moveM[1], dueDate: date } }];
  }

  // Create a task
  const createM = text.match(
    /^(?:please\s+)?(?:(?:create|add|make|new|set up)\s+(?:a\s+|an\s+)?(?:new\s+)?(?:task|to-?do|reminder)(?:\s+(?:to|for|called|named|:))?|remind me to|i need to|i have to|i must|todo:?|to-?do:?)\s+(.+)$/i,
  );
  if (createM) {
    let { date, rest } = extractDate(createM[1], today);
    const pr = extractPriority(rest);
    const title = sentence(pr.rest.replace(/^(to|that i|that)\s+/i, '').replace(/[.!?]+$/, '').trim());
    if (!title) return { reply: 'What should the task be called?' };
    const args = { title };
    if (date) args.dueDate = date;
    if (pr.priority) args.priority = pr.priority;
    return [{ tool: 'createTask', args }];
  }

  return null;
}

export const LOCAL_HELP =
  "I'm running on the offline engine, so I understand a fixed set of commands. Try: " +
  '"Create a task to revise binary trees tomorrow", "Show my pending tasks", "Mark binary trees complete", ' +
  '"Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming", ' +
  '"Add 30 minutes of recursion to tomorrow\'s plan", or "Give me my daily summary".';
