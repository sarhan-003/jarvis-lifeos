// Express API. Every mutating endpoint goes through executeTool so UI edits
// are validated and logged exactly like assistant actions.
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { executeTool, resolveConfirmation } from './executor.js';
import { TOOLS, ToolError } from './tools.js';
import { handleChat, providerInfo } from './agent/index.js';
import { isIsoDate, todayIso } from './dates.js';
import { mcpRoutes, MCP_PROTOCOL_VERSION } from './mcp.js';

const chatBody = z.object({
  message: z.string().trim().min(1, 'message is required').max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(40)
    .optional(),
  today: z.string().refine(isIsoDate).optional(),
});

// Clients send their local calendar date; fall back to the server's.
const requestToday = (req) => {
  const t = req.body?.today ?? req.query?.today;
  return isIsoDate(t) ? t : todayIso();
};

// Map an action record to an HTTP status for the REST endpoints.
function sendAction(res, action, okStatus = 200) {
  const status = action.status === 'error' ? (/not find|No task|no study plan/i.test(action.error) ? 404 : 400) : action.status === 'awaiting_confirmation' ? 202 : okStatus;
  res.status(status).json({ action });
}

// Only local pages (any port) and explicitly listed origins may call the API
// from a browser. Requests without an Origin (curl, MCP clients) are allowed.
const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
export function originAllowed(origin) {
  if (!origin) return true;
  if (extraOrigins.includes(origin)) return true;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function createApp({ store, clientDist } = {}) {
  const app = express();
  app.use((req, res, next) => {
    if (originAllowed(req.get('origin'))) return next();
    res.status(403).json({ error: 'Origin not allowed' });
  });
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '100kb' }));

  const mcp = mcpRoutes({ store });
  app.post('/mcp', ...mcp.guard, mcp.handle);
  app.get('/mcp', ...mcp.guard, mcp.handle);
  app.delete('/mcp', ...mcp.guard, mcp.handle);

  const run = (tool, args, req) => executeTool(tool, args, { store, today: requestToday(req), source: 'ui', request: `${req.method} ${req.path}` });

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      ai: providerInfo(),
      storage: { type: 'json-file', path: path.basename(store.filePath) },
      mcp: { endpoint: '/mcp', transport: 'streamable-http', protocolVersion: MCP_PROTOCOL_VERSION, auth: Boolean(process.env.MCP_AUTH_TOKEN) },
    });
  });

  app.post('/api/chat', async (req, res, next) => {
    const parsed = chatBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
    try {
      const { message, history = [] } = parsed.data;
      const out = await handleChat({ message, history, store, today: requestToday(req) });
      res.json(out);
    } catch (err) {
      next(err);
    }
  });

  // ---- tasks ----
  app.get('/api/tasks', (req, res) => {
    const status = ['pending', 'completed', 'all'].includes(req.query.status) ? req.query.status : 'all';
    res.json({ tasks: store.listTasks({ status }) });
  });
  app.post('/api/tasks', async (req, res) => sendAction(res, await run('createTask', req.body, req), 201));
  app.patch('/api/tasks/:id', async (req, res) => {
    const { title, dueDate, priority, notes } = req.body ?? {};
    sendAction(res, await run('updateTask', { taskId: req.params.id, title, dueDate, priority, notes }, req));
  });
  app.post('/api/tasks/:id/complete', async (req, res) => sendAction(res, await run('completeTask', { taskId: req.params.id }, req)));
  // The UI asks for confirmation before calling this, so it runs immediately.
  app.delete('/api/tasks/:id', async (req, res) =>
    sendAction(res, await executeTool('deleteTask', { taskId: req.params.id }, { store, today: requestToday(req), source: 'ui', request: `DELETE ${req.path}`, confirmed: true })),
  );

  // ---- study plans ----
  app.get('/api/plans', (req, res) => res.json({ plans: store.listPlans() }));
  app.get('/api/plans/:date', (req, res) => {
    const plan = store.getPlanByDate(req.params.date);
    if (!plan) return res.status(404).json({ error: `No study plan for ${req.params.date}` });
    res.json({ plan });
  });

  // ---- summary ----
  app.get('/api/summary', async (req, res) => {
    // Read-only dashboard refresh: run the tool directly so polling doesn't flood the activity log.
    const date = isIsoDate(req.query.date) ? req.query.date : undefined;
    const { result, message } = await TOOLS.getDailySummary.run({ date }, { store, today: requestToday(req) });
    res.json({ summary: result, message });
  });

  // ---- action log + confirmations ----
  app.get('/api/actions', (req, res) => res.json({ actions: store.listActions(Number(req.query.limit) || 50) }));
  app.post('/api/actions/:id/confirm', async (req, res, next) => {
    try {
      res.json({ action: await resolveConfirmation(store, req.params.id, true, requestToday(req)) });
    } catch (err) {
      next(err);
    }
  });
  app.post('/api/actions/:id/cancel', async (req, res, next) => {
    try {
      res.json({ action: await resolveConfirmation(store, req.params.id, false, requestToday(req)) });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

  // Serve the built client in production (npm run build && npm start).
  if (clientDist && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use((err, req, res, next) => {
    if (err instanceof ToolError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
