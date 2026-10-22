// Tool call logging: structured logs via pino plus a ring buffer of the last
// 50 calls for the /debug/calls endpoint.
import { pino } from 'pino';

export interface CallRecord {
  at: string;
  name: string;
  args: unknown;
  durationMs: number;
  isError: boolean;
}

export const logger = pino({ level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info') });

const MAX = 50;
const buffer: CallRecord[] = [];

export function recordCall(entry: CallRecord): void {
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  logger.info({ tool: entry.name, durationMs: entry.durationMs, isError: entry.isError }, 'tool call');
}

export function recentCalls(): CallRecord[] {
  return [...buffer].reverse();
}

export function clearCalls(): void {
  buffer.length = 0;
}
