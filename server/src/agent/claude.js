// Claude tool-calling agent: a manual agentic loop over the tools the Jarvis
// MCP server advertises. Claude chooses tools; they run via MCP tools/call.
import Anthropic from '@anthropic-ai/sdk';
import { MAX_TURNS, systemPrompt, historyMessages, toolResultPayload } from './prompt.js';

let client;

export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function claudeModel() {
  return process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
}

export async function runClaude({ message, history, today, gateway }) {
  client ??= new Anthropic();
  const tools = gateway.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  const provider = `claude:${claudeModel()}`;
  const system = systemPrompt(today);
  const messages = [...historyMessages(history), { role: 'user', content: message }];

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
      const action = await gateway.call(use.name, use.input, { request: message, provider, today });
      actions.push(action);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: action.status === 'error',
        content: toolResultPayload(action),
      });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'I ran out of steps for that request. Please try rephrasing it.', actions };
}
