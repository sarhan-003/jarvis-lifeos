// Anthropic Messages API adapter (tool use). Assistant turns are replayed with
// their original content blocks so thinking blocks stay intact across the loop.
import Anthropic from '@anthropic-ai/sdk';
import type { ToolDef } from '../mcpClient.js';
import { groupToolResults, LlmError, type ChatMessage, type LlmProvider, type LlmTurn } from './provider.js';

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly label: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
    this.label = `Claude (${model})`;
  }

  async chat({ system, messages, tools }: { system: string; messages: ChatMessage[]; tools: ToolDef[] }): Promise<LlmTurn> {
    const params: Anthropic.MessageParam[] = groupToolResults(messages).map((m): Anthropic.MessageParam => {
      if (m.role === 'user') return { role: 'user', content: m.text };
      if (m.role === 'tool_batch') {
        return {
          role: 'user',
          content: m.results.map((r) => ({ type: 'tool_result' as const, tool_use_id: r.toolCallId, content: r.content, is_error: r.isError })),
        };
      }
      if (m.raw?.provider === this.id) return { role: 'assistant', content: m.raw.content as Anthropic.ContentBlockParam[] };
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.text) content.push({ type: 'text', text: m.text });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      return { role: 'assistant', content: content.length ? content : m.text || '...' };
    });

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 16000,
        system,
        output_config: { effort: 'low' },
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
        messages: params,
      });
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw new LlmError(err.message, err.status ?? null);
      throw err;
    }

    if (response.stop_reason === 'refusal') return { text: "Sorry, I can't help with that.", toolCalls: [], refused: true };
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    const toolCalls =
      response.stop_reason === 'tool_use'
        ? response.content
            .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
            .map((b) => ({ id: b.id, name: b.name, args: (b.input ?? {}) as Record<string, unknown> }))
        : [];
    return { text, toolCalls, raw: { provider: this.id, content: response.content } };
  }
}
