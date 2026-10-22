// Chooses the agent for each chat message and turns tool actions into a reply.
//
// AI_PROVIDER:
//   (unset)            Claude if ANTHROPIC_API_KEY is set, else the offline engine
//   local              offline engine
//   anthropic          Claude
//   groq | openrouter | gemini | ollama | openai-compatible
//                      OpenAI-compatible provider (see agent/openai.js)
//
// Whatever the engine, tools are discovered and run through the Jarvis MCP
// server (see gateway.js), the way Alexa+ uses a brand's MCP integration.
import Anthropic from '@anthropic-ai/sdk';
import { parseIntent, LOCAL_HELP } from './local.js';
import { runClaude, claudeAvailable, claudeModel } from './claude.js';
import { runOpenAICompatible, llmConfig, LlmApiError } from './openai.js';
import { connectGateway } from './gateway.js';

// "Alexa, ask Jarvis to add a task..." -> "add a task...". Users of the
// simulator can speak to it the way they would invoke an Alexa+ integration.
export function stripInvocation(text) {
  return text
    .trim()
    .replace(/^(?:hey\s+|ok\s+)?alexa[\s,.!]+(?:(?:ask|tell|have)\s+jarvis(?:\s+lifeos)?(?:\s+(?:to|for|if|whether))?[\s,]+)?/i, '')
    .replace(/^(?:hey\s+|ok\s+)?jarvis(?:\s+lifeos)?[\s,.!]+/i, '')
    .trim();
}

const OFFLINE = { provider: 'local', label: 'Offline intent engine', model: null };

export function providerInfo() {
  const requested = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (requested === 'local') return OFFLINE;

  const llm = llmConfig();
  if (llm) {
    if (llm.missing.length) {
      return { ...OFFLINE, warning: `AI_PROVIDER=${llm.name} needs ${llm.missing.join(', ')}. Using the offline engine.` };
    }
    return { provider: 'llm', name: llm.name, label: `${llm.label} (${llm.model})`, model: llm.model };
  }

  if (claudeAvailable()) return { provider: 'anthropic', label: `Claude (${claudeModel()})`, model: claudeModel() };
  if (requested === 'anthropic') return { ...OFFLINE, warning: 'AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY. Using the offline engine.' };
  if (requested) return { ...OFFLINE, warning: `Unknown AI_PROVIDER "${requested}". Using the offline engine.` };
  return OFFLINE;
}

export function activeProvider() {
  return providerInfo().provider;
}

async function runLocal({ message, store, today, gateway }) {
  const intent = parseIntent(message, { store, today });
  if (!intent) return { reply: LOCAL_HELP, actions: [] };
  if (!Array.isArray(intent)) return { reply: intent.reply, actions: [] };

  const actions = [];
  const lines = [];
  for (const call of intent) {
    const action = await gateway.call(call.tool, call.args, { request: message, provider: 'local', today });
    actions.push(action);
    if (call.note) lines.push(call.note);
    if (action.status === 'success') lines.push(action.message);
    else if (action.status === 'awaiting_confirmation') lines.push(`${action.message} Please confirm or cancel below.`);
    else lines.push(`Sorry, that didn't work: ${action.error}`);
  }
  return { reply: lines.join(' '), actions };
}

// When the LLM call fails (bad key, rate limit, outage), fall back to the
// offline engine so the user is not stuck, and say so plainly.
async function fallback(ctx, notice) {
  const out = await runLocal(ctx);
  return { ...out, provider: OFFLINE, notice: `${notice} Used the offline engine instead.` };
}

async function route(ctx, info) {
  if (info.provider === 'anthropic') {
    try {
      return { ...(await runClaude(ctx)), provider: info };
    } catch (err) {
      if (!(err instanceof Anthropic.APIError)) throw err;
      return fallback(ctx, `Claude API error (${err.status ?? 'network'}): ${err.message}.`);
    }
  }

  if (info.provider === 'llm') {
    const cfg = llmConfig();
    try {
      return { ...(await runOpenAICompatible({ ...ctx, cfg })), provider: info };
    } catch (err) {
      if (!(err instanceof LlmApiError)) throw err;
      return fallback(ctx, `${cfg.label} API error (${err.status ?? 'network'}): ${err.message}.`);
    }
  }

  return { ...(await runLocal(ctx)), provider: info };
}

export async function handleChat({ message, history = [], store, today }) {
  const info = providerInfo();
  const gateway = await connectGateway({ store });
  try {
    const ctx = { message: stripInvocation(message) || message, history, store, today, gateway };
    const out = await route(ctx, info);
    return { ...out, mcp: { transport: gateway.transport, toolsDiscovered: gateway.tools.length } };
  } finally {
    await gateway.close();
  }
}
