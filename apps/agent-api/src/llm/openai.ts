// OpenAI-compatible Chat Completions adapter: free tiers of Gemini and Groq,
// OpenRouter free models, or a local Ollama model.
import type { ToolDef } from '../mcpClient.js';
import { LlmError, type ChatMessage, type LlmProvider, type LlmTurn } from './provider.js';

export const OPENAI_PRESETS: Record<string, { label: string; baseURL: string | null; model: string | null; needsKey: boolean }> = {
  gemini: { label: 'Gemini', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', needsKey: true },
  groq: { label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', needsKey: true },
  openrouter: { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: null, needsKey: true },
  ollama: { label: 'Ollama', baseURL: 'http://localhost:11434/v1', model: null, needsKey: false },
  'openai-compatible': { label: 'OpenAI-compatible LLM', baseURL: null, model: null, needsKey: false },
};

interface OaiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly id: string;
  readonly label: string;

  constructor(
    preset: string,
    private readonly baseURL: string,
    private readonly model: string,
    private readonly apiKey?: string,
  ) {
    this.id = preset;
    this.label = `${OPENAI_PRESETS[preset]?.label ?? preset} (${model})`;
  }

  async chat({ system, messages, tools }: { system: string; messages: ChatMessage[]; tools: ToolDef[] }): Promise<LlmTurn> {
    const oai: OaiMessage[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') oai.push({ role: 'user', content: m.text });
      else if (m.role === 'tool') oai.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
      else
        oai.push({
          role: 'assistant',
          content: m.text || null,
          ...(m.toolCalls.length
            ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
            : {}),
        });
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseURL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.model,
          messages: oai,
          tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
          tool_choice: 'auto',
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new LlmError(`cannot reach ${this.baseURL}: ${(err as Error).message}`, null);
    }
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    } | null;
    if (!res.ok) throw new LlmError(data?.error?.message ?? `HTTP ${res.status}`, res.status);
    const message = data?.choices?.[0]?.message;
    if (!message) throw new LlmError('response contained no message', res.status);

    const toolCalls = (message.tool_calls ?? []).map((c) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = c.function.arguments ? JSON.parse(c.function.arguments) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        // Broken JSON from the model: send empty args; the MCP server will
        // reject them and the model sees the validation error.
      }
      return { id: c.id, name: c.function.name, args };
    });
    return { text: (message.content ?? '').trim(), toolCalls };
  }
}
