// Prompt and conversation helpers shared by every LLM provider.
import { weekdayOf } from '../dates.js';

const SYSTEM = `You are Jarvis, a concise voice-first study and productivity assistant (an Alexa+-style experience).
You manage the user's real tasks and study plans ONLY through the provided tools. Never claim an action happened unless a tool result says status "success".
Rules:
- Use tools for anything involving tasks, study plans or summaries. Use listTasks before guessing what exists.
- Dates must be YYYY-MM-DD. Resolve words like "tomorrow" from the current date below.
- To identify an existing task, pass taskQuery with words from its title (or taskId if known).
- For study plans, pass every requested topic with its minutes; the backend computes the timed schedule.
- If a tool returns status "awaiting_confirmation", tell the user to confirm in the app; do not call the tool again.
- If a tool returns an error, explain it briefly and ask a clarifying question if needed.
- Replies are spoken aloud: 1-3 short sentences, no markdown, no lists, no emoji.`;

export const MAX_TURNS = 6;

export function systemPrompt(today) {
  return `${SYSTEM}\n\nCurrent date: ${today} (${weekdayOf(today)}).`;
}

// Prior turns are plain text. Merge repeated roles, start with a user turn and
// end with an assistant turn so the new user message keeps roles alternating.
export function historyMessages(history) {
  const messages = [];
  for (const turn of history.slice(-10)) {
    const role = turn.role === 'assistant' ? 'assistant' : 'user';
    if (!messages.length && role === 'assistant') continue;
    if (messages.at(-1)?.role === role) messages.at(-1).content += `\n${turn.text}`;
    else messages.push({ role, content: turn.text });
  }
  if (messages.at(-1)?.role === 'user') messages.push({ role: 'assistant', content: 'Okay.' });
  return messages;
}

// What the model sees after a tool runs.
export function toolResultPayload(action) {
  return JSON.stringify({
    status: action.status,
    message: action.message ?? null,
    error: action.error ?? null,
    result: action.result ?? null,
  });
}
