// MCP client for the Parcel Concierge server over Streamable HTTP. Caches the
// tool list and reconnects once if a call fails because the connection dropped.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallResult {
  text: string;
  structured: Record<string, unknown> | null;
  isError: boolean;
  durationMs: number;
}

export interface ToolGateway {
  listTools(): Promise<ToolDef[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}

export class McpToolGateway implements ToolGateway {
  private client: Client | null = null;
  private tools: ToolDef[] | null = null;

  constructor(
    private readonly url: string,
    private readonly token?: string,
  ) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: 'parcel-concierge-agent', title: 'Simulated Alexa+ (Parcel Concierge)', version: '1.0.0' });
    const headers = this.token ? { authorization: `Bearer ${this.token}` } : undefined;
    await client.connect(new StreamableHTTPClientTransport(new URL(this.url), { requestInit: { headers } }));
    this.client = client;
    return client;
  }

  private async reset(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.tools = null;
    await c?.close().catch(() => undefined);
  }

  private async withRetry<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.connect());
    } catch {
      await this.reset();
      return fn(await this.connect());
    }
  }

  async listTools(): Promise<ToolDef[]> {
    if (this.tools) return this.tools;
    const { tools } = await this.withRetry((c) => c.listTools());
    this.tools = tools.map((t: Tool) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const started = performance.now();
    const result = await this.withRetry((c) => c.callTool({ name, arguments: args }));
    const content = Array.isArray(result.content) ? (result.content as { type: string; text?: string }[]) : [];
    return {
      text: content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(' ').trim(),
      structured: (result.structuredContent as Record<string, unknown> | undefined) ?? null,
      isError: Boolean(result.isError),
      durationMs: Math.round(performance.now() - started),
    };
  }
}
