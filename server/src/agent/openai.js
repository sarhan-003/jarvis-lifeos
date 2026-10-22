// OpenAI-compatible tool-calling agent (Chat Completions + function tools).
// One implementation covers Groq, OpenRouter, Gemini's OpenAI endpoint,
// Ollama and any other server that speaks the same format. The model picks
// from the tools the Jarvis MCP server advertises; they run via MCP tools/call.
import { MAX_TURNS, systemPrompt, historyMessages, toolResultPayload } from './prompt.js';

// AI_PROVIDER values. LLM_BASE_URL / LLM_MODEL override the preset defaults.
// Defaults are starting points: free-tier model lists change, so check the
// provider's model page and set LLM_MODEL if a default stops working.
export const PRESETS = {
  groq: { label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', needsKey: true },
  openrouter: { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: null, needsKey: true },
  gemini: { label: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', needsKey: true },
  ollama: { label: 'Ollama', baseURL: 'http://localhost:11434/v1', model: null, needsKey: false },
  'openai-compatible': { label: 'OpenAI-compatible LLM', baseURL: null, model: null, needsKey: false },
};

const REQUEST_TIMEOUT_MS = 60_000;

export class LlmApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Resolved configuration for the requested preset, or null when AI_PROVIDER
// does not name an OpenAI-compatible provider. `missing` lists env vars that
// must be set before the provider can be used.
export function llmConfig() {
  const name = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  const preset = PRESETS[name];
  if (!preset) return null;
  const baseURL = (process.env.LLM_BASE_URL || preset.baseURL || '').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || preset.model;
  const apiKey = process.env.LLM_API_KEY || '';
  const missing = [];
  if (!baseURL) missing.push('LLM_BASE_URL');
  if (!model) missing.push('LLM_MODEL');
  if (preset.needsKey && !apiKey) missing.push('LLM_API_KEY');
  return { name, label: preset.label, baseURL, model, apiKey, missing };
}

async function chatCompletion(cfg, body) {
  let res;
  try {
    res = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new LlmApiError(`cannot reach ${cfg.baseURL} (${err.name === 'TimeoutError' ? 'timed out' : err.message})`, null);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.message || (Array.isArray(data) && data[0]?.error?.message) || res.statusText;
    throw new LlmApiError(detail || `HTTP ${res.status}`, res.status);
  }
  const choice = data?.choices?.[0];
  if (!choice?.message) throw new LlmApiError('the response contained no message', res.status);
  return choice;
}

function parseArguments(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function runOpenAICompatible({ message, history, store, today, cfg, gateway }) {
  const tools = gateway.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  const messages = [{ role: 'system', content: systemPrompt(today) }, ...historyMessages(history), { role: 'user', content: message }];
  const provider = `${cfg.name}:${cfg.model}`;
  const actions = [];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const choice = await chatCompletion(cfg, { model: cfg.model, messages, tools, tool_choice: 'auto' });
    const reply = choice.message;
    const calls = reply.tool_calls ?? [];
    if (!calls.length) {
      return { reply: (reply.content || '').trim() || 'Done.', actions };
    }

    messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const name = call.function?.name;
      const args = parseArguments(call.function?.arguments);
      let action;
      if (args === null) {
        // Small models sometimes emit broken JSON. Log it and let the model retry.
        action = await store.logAction({
          request: message,
          source: 'assistant',
          provider,
          tool: name,
          args: { raw: String(call.function?.arguments).slice(0, 2000) },
          status: 'error',
          error: 'The model sent tool arguments that are not a valid JSON object.',
        });
      } else {
        action = await gateway.call(name, args, { request: message, provider, today });
      }
      actions.push(action);
      messages.push({ role: 'tool', tool_call_id: call.id, content: toolResultPayload(action) });
    }
  }
  return { reply: 'I ran out of steps for that request. Please try rephrasing it.', actions };
}
