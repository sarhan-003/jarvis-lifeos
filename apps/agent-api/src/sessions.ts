// In-memory conversation history per browser session.
import type { ChatMessage } from './llm/provider.js';

const MAX_MESSAGES = 20;

export class SessionStore {
  private readonly sessions = new Map<string, ChatMessage[]>();

  get(id: string): ChatMessage[] {
    return [...(this.sessions.get(id) ?? [])];
  }

  /** Keep the last ~20 messages, always starting at a user turn so tool calls and results stay paired. */
  set(id: string, messages: ChatMessage[]): void {
    let trimmed = messages.slice(-MAX_MESSAGES);
    const firstUser = trimmed.findIndex((m) => m.role === 'user');
    trimmed = firstUser > 0 ? trimmed.slice(firstUser) : trimmed;
    this.sessions.set(id, trimmed);
  }

  clear(id?: string): void {
    if (id) this.sessions.delete(id);
    else this.sessions.clear();
  }
}
