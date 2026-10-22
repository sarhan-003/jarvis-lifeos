// The simulated Alexa+ assistant reaches the Jarvis LifeOS "brand" service
// the way Alexa+ reaches brand integrations: as an MCP client. Tools are
// discovered with tools/list and executed with tools/call on the Jarvis MCP
// server. The running app connects over Streamable HTTP to its own /mcp
// endpoint; when no URL is set (tests), an in-process MCP link is used.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../mcp.js';

let mcpUrl = null;

// Called by index.js once the server is listening.
export function setGatewayUrl(url) {
  mcpUrl = url;
}

export function gatewayTransportName() {
  return mcpUrl ? 'streamable-http' : 'in-process';
}

export async function connectGateway({ store }) {
  const client = new Client({ name: 'alexa-plus-simulator', title: 'Alexa+ simulator (Jarvis LifeOS)', version: '1.0.0' });
  let transport;
  let server = null;
  if (mcpUrl) {
    const headers = process.env.MCP_AUTH_TOKEN ? { authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` } : undefined;
    transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } });
  } else {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    server = createMcpServer({ store });
    await server.connect(serverSide);
    transport = clientSide;
  }
  await client.connect(transport);
  const { tools } = await client.listTools();

  return {
    transport: gatewayTransportName(),
    tools, // MCP tool descriptors: { name, title, description, inputSchema, annotations }

    // Run one tool over MCP and return the action record the server logged.
    async call(name, args, { request, provider, today }) {
      const result = await client.callTool({
        name,
        arguments: args ?? {},
        _meta: { 'jarvis/request': request, 'jarvis/provider': provider, 'jarvis/today': today },
      });
      const id = result.structuredContent?.actionId;
      const logged = id ? store.getAction(id) : null;
      if (logged) return logged;
      // Fallback for a remote server whose log we cannot read.
      return {
        id: id ?? null,
        tool: name,
        args,
        via: 'mcp',
        source: 'assistant',
        provider,
        request,
        status: result.structuredContent?.status ?? (result.isError ? 'error' : 'success'),
        message: result.structuredContent?.message ?? result.content?.[0]?.text ?? null,
        error: result.structuredContent?.error ?? (result.isError ? result.content?.[0]?.text : null),
        result: result.structuredContent?.result ?? null,
        createdAt: new Date().toISOString(),
      };
    },

    async close() {
      try {
        if (transport instanceof StreamableHTTPClientTransport) await transport.terminateSession();
      } catch {
        // Session already gone; nothing to clean up.
      }
      await client.close();
      if (server) await server.close();
    },
  };
}
