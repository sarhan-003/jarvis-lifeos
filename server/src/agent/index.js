// Chooses the agent for each chat message and turns tool actions into a reply.
import Anthropic from '@anthropic-ai/sdk';
import { executeTool } from '../executor.js';
import { parseIntent, LOCAL_HELP } from './local.js';
import { runClaude, claudeAvailable, claudeModel } from './claude.js';

export function activeProvider() {
  if ((process.env.AI_PROVIDER || '').toLowerCase() === 'local') return 'local';
  return claudeAvailable() ? 'anthropic' : 'local';
}

export function providerInfo() {
  const provider = activeProvider();
  return provider === 'anthropic'
    ? { provider, label: `Claude (${claudeModel()})`, model: claudeModel() }
    : { provider, label: 'Offline intent engine', model: null };
}

async function runLocal({ message, store, today }) {
  const intent = parseIntent(message, { store, today });
  if (!intent) return { reply: LOCAL_HELP, actions: [] };
  if (!Array.isArray(intent)) return { reply: intent.reply, actions: [] };

  const actions = [];
  const lines = [];
  for (const call of intent) {
    const action = await executeTool(call.tool, call.args, { store, today, request: message, source: 'assistant', provider: 'local' });
    actions.push(action);
    if (call.note) lines.push(call.note);
    if (action.status === 'success') lines.push(action.message);
    else if (action.status === 'awaiting_confirmation') lines.push(`${action.message} Please confirm or cancel below.`);
    else lines.push(`Sorry, that didn't work: ${action.error}`);
  }
  return { reply: lines.join(' '), actions };
}

export async function handleChat({ message, history = [], store, today }) {
  const info = providerInfo();
  if (info.provider === 'anthropic') {
    try {
      const out = await runClaude({ message, history, store, today });
      return { ...out, provider: info };
    } catch (err) {
      if (!(err instanceof Anthropic.APIError)) throw err;
      // The Claude call failed (bad key, rate limit, outage). Fall back to the
      // offline engine so the user is not stuck, and say so plainly.
      const out = await runLocal({ message, store, today });
      return {
        ...out,
        provider: { provider: 'local', label: 'Offline intent engine', model: null },
        notice: `Claude API error (${err.status ?? 'network'}): ${err.message}. Used the offline engine instead.`,
      };
    }
  }
  const out = await runLocal({ message, store, today });
  return { ...out, provider: info };
}
