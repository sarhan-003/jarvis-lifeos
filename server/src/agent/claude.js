// Claude tool-calling agent: a manual agentic loop over the shared tool
// catalogue. Claude chooses tools; the backend validates and executes them.
import Anthropic from '@anthropic-ai/sdk';
import { toolJsonSchemas } from '../tools.js';
import { executeTool } from '../executor.js';
import { weekdayOf } from '../dates.js';

const MAX_TURNS = 6;
let client;

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

export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function claudeModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
}

export async function runClaude({ message, history, store, today }) {
  client ??= new Anthropic();
  const tools = toolJsonSchemas();
  const system = `${SYSTEM}\n\nCurrent date: ${today} (${weekdayOf(today)}).`;

  // Prior turns are plain text; the conversation must start with a user turn.
  const messages = [];
  for (const turn of history.slice(-10)) {
    const role = turn.role === 'assistant' ? 'assistant' : 'user';
    if (!messages.length && role === 'assistant') continue;
    if (messages.at(-1)?.role === role) messages.at(-1).content += `\n${turn.text}`;
    else messages.push({ role, content: turn.text });
  }
  if (messages.at(-1)?.role === 'user') messages.push({ role: 'assistant', content: 'Okay.' });
  messages.push({ role: 'user', content: message });

  const actions = [];
  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const response = await client.messages.create({
      model: claudeModel(),
      max_tokens: 16000,
      system,
      tools,
      output_config: { effort: 'low' },
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return { reply: "Sorry, I can't help with that request.", actions };
    }
    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();

    if (response.stop_reason !== 'tool_use' || !toolUses.length) {
      return { reply: text || 'Done.', actions };
    }

    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const use of toolUses) {
      const action = await executeTool(use.name, use.input, {
        store,
        today,
        request: message,
        source: 'assistant',
        provider: `claude:${claudeModel()}`,
      });
      actions.push(action);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: action.status === 'error',
        content: JSON.stringify({
          status: action.status,
          message: action.message ?? null,
          error: action.error ?? null,
          result: action.result ?? null,
        }),
      });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'I ran out of steps for that request. Please try rephrasing it.', actions };
}
