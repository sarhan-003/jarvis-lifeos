// Shared helpers for tool registration.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { OpResult, ParcelConcierge } from '@parcel/domain';
import { recordCall } from '../callLog.js';

export interface ToolContext {
  service: ParcelConcierge;
}

export const SHIPMENT_ARG = z
  .string()
  .min(1)
  .describe('The parcel: its nickname as the user says it (e.g. "phone", "my running shoes") or its tracking number (e.g. SLX4820193756).');

/**
 * Every result has a common envelope so clients can render it: `ok`, plus the
 * operation's data on success or `error`/`candidates` on failure.
 */
export const resultEnvelope = (shape: z.ZodRawShape = {}) =>
  z
    .object({
      ok: z.boolean(),
      speech: z.string().describe('The same short, speakable summary as the text content'),
      error: z.string().optional(),
      candidates: z.array(z.string()).optional(),
      ...shape,
    })
    .catchall(z.unknown());

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export function toResult<T extends object>(result: OpResult<T>): CallToolResult {
  return {
    content: [{ type: 'text', text: result.speech }],
    structuredContent: { ok: result.ok, speech: result.speech, ...result.data },
    isError: !result.ok,
  };
}

/** Time a handler, record it in the call log, and never leak stack traces. */
export function withLogging<A>(name: string, fn: (args: A) => CallToolResult): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    const started = performance.now();
    let result: CallToolResult;
    try {
      result = fn(args);
    } catch {
      const text = 'Sorry, something went wrong on the SwiftLane side. Please try again.';
      result = { content: [{ type: 'text', text }], structuredContent: { ok: false, speech: text, error: text }, isError: true };
    }
    recordCall({
      at: new Date().toISOString(),
      name,
      args,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
      isError: Boolean(result.isError),
    });
    return result;
  };
}
