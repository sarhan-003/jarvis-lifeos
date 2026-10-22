// Agent API (backend for the React simulator): /api/chat runs the tool loop,
// /api/reset clears the session and the demo data, /api/health reports status.
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { HealthResponse } from '@parcel/domain';
import type { Env } from './env.js';
import { McpToolGateway, type ToolGateway } from './mcpClient.js';
import { chooseProvider, type ProviderChoice } from './providers.js';
import { SessionStore } from './sessions.js';
import { runChat } from './chat.js';

const ChatBody = z.object({
  sessionId: z.string().min(1).max(100),
  message: z.string().trim().min(1, 'message is required').max(2000),
});

export interface AgentAppOptions {
  env: Env;
  gateway?: ToolGateway;
  choice?: ProviderChoice;
  now?: () => Date;
}

export function createAgentApp({ env, gateway: injected, choice: injectedChoice, now }: AgentAppOptions) {
  const gateway = injected ?? new McpToolGateway(env.MCP_SERVER_URL, env.MCP_DEV_TOKEN);
  const choice = injectedChoice ?? chooseProvider(env, gateway);
  const sessions = new SessionStore();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', async (_req, res) => {
    const body: HealthResponse = {
      ok: true,
      engine: choice.provider.label,
      ...(choice.warning ? { engineWarning: choice.warning } : {}),
      mcp: { url: env.MCP_SERVER_URL, reachable: false, tools: 0 },
    };
    try {
      body.mcp.tools = (await gateway.listTools()).length;
      body.mcp.reachable = true;
    } catch (err) {
      body.mcp.error = (err as Error).message;
    }
    res.json(body);
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
      return;
    }
    const { sessionId, message } = parsed.data;
    try {
      const { response, history } = await runChat({
        provider: choice.provider,
        offline: choice.offline,
        gateway,
        history: sessions.get(sessionId),
        message,
        ...(now ? { now: now() } : {}),
      });
      sessions.set(sessionId, history);
      res.json(response);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'The assistant hit an unexpected error.' });
    }
  });

  app.post('/api/reset', async (req: Request, res: Response) => {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    sessions.clear(sessionId);
    let dataReset = false;
    try {
      const r = await fetch(new URL('/debug/reset', env.MCP_SERVER_URL), { method: 'POST' });
      dataReset = r.ok;
    } catch {
      // MCP server unreachable or debug endpoints disabled; the session is still cleared.
    }
    res.json({ ok: true, dataReset });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Production: serve the built React app with SPA fallback.
  const dist = env.WEB_DIST ? path.resolve(env.WEB_DIST) : null;
  if (dist && fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return app;
}
