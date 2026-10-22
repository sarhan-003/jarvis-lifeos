// The tool loop: the model picks MCP tools, the agent calls them on the
// Parcel Concierge server, and the results go back to the model.
import type { ChatResponse, ToolCallTrace } from '@parcel/domain';
import type { ToolGateway, ToolCallResult } from './mcpClient.js';
import { LlmError, type ChatMessage, type LlmProvider } from './llm/provider.js';
import { cardsForTurn, type TurnToolResult } from './cards.js';
import { systemPrompt } from './systemPrompt.js';

const MAX_ROUNDS = 6;
const MAX_TOOL_CONTENT = 6000;

/** Voice output: no markdown, no lists. */
export function toSpeech(text: string): string {
  return text
    .replace(/[*_#`>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ChatArgs {
  provider: LlmProvider;
  offline: LlmProvider;
  gateway: ToolGateway;
  history: ChatMessage[];
  message: string;
  now?: Date;
}

export async function runChat({ provider, offline, gateway, history, message, now }: ChatArgs): Promise<{ response: ChatResponse; history: ChatMessage[] }> {
  const base: ChatMessage[] = [...history, { role: 'user', text: message }];
  let messages = [...base];
  let active = provider;
  let notice: string | undefined;
  const results: TurnToolResult[] = [];
  const traces: ToolCallTrace[] = [];

  let tools;
  try {
    tools = await gateway.listTools();
  } catch (err) {
    const text = "I can't reach the Parcel Concierge service right now. Please try again in a moment.";
    return {
      response: { speech: text, cards: [{ type: 'error', data: { message: `MCP server unreachable: ${(err as Error).message}` } }], toolCalls: [], engine: active.label },
      history,
    };
  }

  let finalText = '';
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let turn;
    try {
      turn = await active.chat({ system: systemPrompt(now), messages, tools });
    } catch (err) {
      if (!(err instanceof LlmError) || active === offline) throw err;
      notice = `${active.label} failed (${err.status ?? 'network'}: ${err.message}). Used the offline engine instead.`;
      if (results.length) {
        // Tools already ran this turn; don't repeat them. Report what happened.
        finalText = results.map((r) => r.text).join(' ');
        break;
      }
      active = offline;
      messages = [...base];
      round -= 1;
      continue;
    }

    messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, ...(turn.raw ? { raw: turn.raw } : {}) });
    if (!turn.toolCalls.length) {
      finalText = turn.text;
      break;
    }

    for (const call of turn.toolCalls) {
      let r: ToolCallResult;
      try {
        r = await gateway.callTool(call.name, call.args);
      } catch (err) {
        const text = `The ${call.name} tool could not be reached: ${(err as Error).message}`;
        r = { text, structured: { ok: false, speech: text, error: text }, isError: true, durationMs: 0 };
      }
      results.push({ name: call.name, args: call.args, structured: r.structured, text: r.text, isError: r.isError });
      traces.push({ name: call.name, args: call.args, durationMs: r.durationMs, isError: r.isError, text: r.text });
      const payload = JSON.stringify(r.structured ?? { speech: r.text });
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: payload.slice(0, MAX_TOOL_CONTENT), isError: r.isError });
    }
  }

  if (!finalText) finalText = results.at(-1)?.text ?? "Sorry, I couldn't finish that. Please try rephrasing.";
  return {
    response: {
      speech: toSpeech(finalText),
      cards: cardsForTurn(results),
      toolCalls: traces,
      engine: active.label,
      ...(notice ? { notice } : {}),
    },
    history: messages,
  };
}
