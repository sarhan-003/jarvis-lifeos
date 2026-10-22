// Express host for the MCP server: stateless Streamable HTTP at /mcp, plus
// health and demo/debug endpoints.
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { InMemoryShipmentStore, ParcelConcierge, type ShipmentStore } from '@parcel/domain';
import { createParcelServer } from './server.js';
import { clearCalls, logger, recentCalls } from './callLog.js';

export interface AppOptions {
  store?: ShipmentStore;
  service?: ParcelConcierge;
}

const rpcError = (res: Response, status: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

export function createApp(options: AppOptions = {}) {
  const store = options.store ?? new InMemoryShipmentStore();
  const service = options.service ?? new ParcelConcierge(store);
  const debugEnabled = process.env.NODE_ENV !== 'production' || process.env.DEBUG_CALLS === 'true';

  const app = express();
  app.use(cors({ exposedHeaders: ['Mcp-Session-Id'] }));
  app.use(express.json({ limit: '256kb' }));

  // DNS-rebinding protection for local runs. When deployed behind a public
  // hostname, list it in MCP_ALLOWED_HOSTS.
  const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const guard = hostHeaderValidation(['localhost', '127.0.0.1', '[::1]', ...allowedHosts]);
  const mcpGuard = allowedHosts.includes('*') ? [] : [guard];

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, name: 'parcel-concierge', transport: 'streamable-http', path: '/mcp' });
  });

  // Stateless Streamable HTTP: a fresh server + transport per request.
  app.post('/mcp', ...mcpGuard, async (req: Request, res: Response) => {
    const server = createParcelServer(service);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err }, 'MCP request failed');
      if (!res.headersSent) rpcError(res, 500, 'Internal server error');
    }
  });
  app.get('/mcp', ...mcpGuard, (_req, res) => rpcError(res.set('Allow', 'POST'), 405, 'Method not allowed.'));
  app.delete('/mcp', ...mcpGuard, (_req, res) => rpcError(res.set('Allow', 'POST'), 405, 'Method not allowed.'));

  if (debugEnabled) {
    app.get('/debug/calls', (_req, res) => {
      res.json({ calls: recentCalls() });
    });
    app.post('/debug/reset', (_req, res) => {
      store.resetDemo();
      clearCalls();
      res.json({ ok: true });
    });
  }

  return app;
}
