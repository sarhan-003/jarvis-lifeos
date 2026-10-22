// Amazon Bedrock Converse API adapter (tool use). Credentials come from the
// standard AWS chain (env vars, profile, or role); none are hard-coded.
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import type { ToolDef } from '../mcpClient.js';
import { groupToolResults, LlmError, type ChatMessage, type LlmProvider, type LlmTurn } from './provider.js';

export class BedrockProvider implements LlmProvider {
  readonly id = 'bedrock';
  readonly label: string;
  private readonly client: BedrockRuntimeClient;

  constructor(
    region: string,
    private readonly modelId: string,
  ) {
    this.client = new BedrockRuntimeClient({ region });
    this.label = `Amazon Bedrock (${modelId})`;
  }

  async chat({ system, messages, tools }: { system: string; messages: ChatMessage[]; tools: ToolDef[] }): Promise<LlmTurn> {
    const converse: Message[] = groupToolResults(messages).map((m): Message => {
      if (m.role === 'user') return { role: 'user', content: [{ text: m.text }] };
      if (m.role === 'tool_batch') {
        return {
          role: 'user',
          content: m.results.map(
            (r): ContentBlock => ({ toolResult: { toolUseId: r.toolCallId, content: [{ text: r.content }], status: r.isError ? 'error' : 'success' } }),
          ),
        };
      }
      if (m.raw?.provider === this.id) return { role: 'assistant', content: m.raw.content as ContentBlock[] };
      const content: ContentBlock[] = [];
      if (m.text) content.push({ text: m.text });
      // Converse document types are JSON values; the cast narrows our plain object to it.
      for (const c of m.toolCalls) content.push({ toolUse: { toolUseId: c.id, name: c.name, input: c.args as never } });
      return { role: 'assistant', content: content.length ? content : [{ text: '...' }] };
    });

    const toolSpecs: Tool[] = tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as never } } }));

    let output;
    try {
      output = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          system: [{ text: system }],
          messages: converse,
          toolConfig: { tools: toolSpecs },
          inferenceConfig: { maxTokens: 4096 },
        }),
      );
    } catch (err) {
      const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      throw new LlmError(`${e.name ?? 'BedrockError'}: ${e.message ?? 'request failed'}`, e.$metadata?.httpStatusCode ?? null);
    }

    const content = output.output?.message?.content ?? [];
    const text = content
      .map((b) => b.text ?? '')
      .join(' ')
      .trim();
    const toolCalls =
      output.stopReason === 'tool_use'
        ? content
            .filter((b) => b.toolUse)
            .map((b) => ({ id: b.toolUse?.toolUseId ?? '', name: b.toolUse?.name ?? '', args: (b.toolUse?.input ?? {}) as Record<string, unknown> }))
        : [];
    return { text, toolCalls, raw: { provider: this.id, content } };
  }
}
