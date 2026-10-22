// Provider-neutral conversation model for the tool loop. Each adapter maps
// these messages to its own API format.
import type { ToolDef } from '../mcpClient.js';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'user'; text: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      /** Provider-native content (e.g. thinking blocks) replayed unchanged to the same provider. */
      raw?: { provider: string; content: unknown };
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError: boolean };

export interface LlmTurn {
  text: string;
  toolCalls: ToolCall[];
  raw?: { provider: string; content: unknown };
  refused?: boolean;
}

export interface LlmProvider {
  readonly id: string;
  readonly label: string;
  chat(args: { system: string; messages: ChatMessage[]; tools: ToolDef[] }): Promise<LlmTurn>;
}

/** A provider/API failure that should fall back to the offline engine. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/**
 * Tool results that belong to the same assistant turn, grouped so adapters
 * can send them back together (Anthropic and Bedrock require one message).
 */
export type ToolResultMessage = Extract<ChatMessage, { role: 'tool' }>;
export type GroupedMessage = Exclude<ChatMessage, ToolResultMessage> | { role: 'tool_batch'; results: ToolResultMessage[] };

export function groupToolResults(messages: ChatMessage[]): GroupedMessage[] {
  const out: GroupedMessage[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (m.role === 'tool') {
      if (last && last.role === 'tool_batch') last.results.push(m);
      else out.push({ role: 'tool_batch', results: [m] });
    } else {
      out.push(m);
    }
  }
  return out;
}
