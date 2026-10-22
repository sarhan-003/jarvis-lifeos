// Self-hosted MCP server (protocol 2025-11-25, Streamable HTTP) exposing the
// same tool catalogue the web assistant uses. Alexa+-style agents, Claude
// Desktop or any MCP client can manage the user's tasks and study plans.
//
// The low-level Server is used on purpose: tools/list serves the exact JSON
// Schemas Claude gets, and tools/call runs through executeTool so MCP calls
// get the same date normalization, validation, confirmation and action log.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { CallToolRequestSchema, ListToolsRequestSchema, LATEST_PROTOCOL_VERSION, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { toolJsonSchemas } from './tools.js';
import { executeTool, resolveConfirmation } from './executor.js';
import { todayIso, isIsoDate } from './dates.js';

export const MCP_PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

const TITLES = {
  createTask: 'Create task',
  listTasks: 'List tasks',
  updateTask: 'Update task',
  completeTask: 'Complete task',
  deleteTask: 'Delete task',
  generateStudyPlan: 'Generate study plan',
  updateStudyPlan: 'Update study plan',
  getDailySummary: 'Daily summary',
};

const ANNOTATIONS = {
  listTasks: { readOnlyHint: true, openWorldHint: false },
  getDailySummary: { readOnlyHint: true, openWorldHint: false },
  createTask: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  updateTask: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  completeTask: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  updateStudyPlan: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  generateStudyPlan: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  deleteTask: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
};

function toCallResult(action) {
  const text =
    action.status === 'success'
      ? action.message
      : action.status === 'error'
        ? `Error: ${action.error}`
        : action.status === 'cancelled'
          ? 'The user declined, so nothing was changed.'
          : `${action.message} Waiting for the user to confirm in the Jarvis LifeOS dashboard (Activity, action ${action.id}).`;
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      actionId: action.id,
      status: action.status,
      message: action.message ?? null,
      error: action.error ?? null,
      result: action.result ?? null,
    },
    isError: action.status === 'error',
  };
}

export function createMcpServer({ store }) {
  const server = new Server(
    { name: 'jarvis-lifeos', title: 'Jarvis LifeOS', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Jarvis LifeOS manages a student\'s tasks and study plans. Dates are YYYY-MM-DD (relative words like "tomorrow" are also accepted). ' +
        'Identify tasks by taskQuery (words from the title) or taskId. Destructive tools ask the user to confirm.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolJsonSchemas().map((t) => ({
      name: t.name,
      title: TITLES[t.name],
      description: t.description,
      inputSchema: t.input_schema,
      annotations: { title: TITLES[t.name], ...ANNOTATIONS[t.name] },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args = {} } = request.params;
    // The Alexa+ simulator passes the user's words, its engine and the user's
    // calendar date in _meta so the action log shows the full story.
    const meta = request.params._meta ?? {};
    const today = isIsoDate(meta['jarvis/today']) ? meta['jarvis/today'] : todayIso();
    const ctx = meta['jarvis/request']
      ? { store, today, via: 'mcp', source: 'assistant', provider: String(meta['jarvis/provider'] ?? 'unknown'), request: String(meta['jarvis/request']) }
      : { store, today, via: 'mcp', source: 'mcp', provider: 'mcp', request: `MCP tools/call ${name}` };
    let action = await executeTool(name, args, ctx);

    // Human-in-the-loop: when the client supports elicitation, ask the user
    // directly. Otherwise the action stays pending for the dashboard.
    if (action.status === 'awaiting_confirmation' && server.getClientCapabilities()?.elicitation) {
      try {
        const answer = await server.elicitInput(
          {
            mode: 'form',
            message: action.message,
            requestedSchema: {
              type: 'object',
              properties: { confirm: { type: 'boolean', title: 'Confirm', description: action.message } },
              required: ['confirm'],
            },
          },
          { relatedRequestId: extra.requestId },
        );
        const approved = answer.action === 'accept' && answer.content?.confirm === true;
        action = await resolveConfirmation(store, action.id, approved, today);
      } catch {
        // Elicitation failed or timed out: leave the action pending.
      }
    }
    return toCallResult(action);
  });

  return server;
}

// Express handlers for the /mcp endpoint. Stateful Streamable HTTP: the
// session remembers the client's capabilities, which elicitation needs, and
// lets the client's elicitation answer arrive as its own POST.
const SESSION_IDLE_MS = 30 * 60 * 1000;

export function mcpRoutes({ store }) {
  const sessions = new Map(); // sessionId -> { transport, server, lastSeen }
  const allowed = ['localhost', '127.0.0.1', '[::1]', ...(process.env.MCP_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean)];
  const token = process.env.MCP_AUTH_TOKEN;

  const auth = (req, res, next) => {
    if (!token || req.get('authorization') === `Bearer ${token}`) return next();
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  };

  const rpcError = (res, status, code, message) => res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

  // Drop sessions whose client went away without sending DELETE.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, s] of sessions) if (s.lastSeen < cutoff) s.transport.close();
  }, 60 * 1000);
  sweep.unref();

  const handle = async (req, res) => {
    const sessionId = req.get('mcp-session-id');
    try {
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return rpcError(res, 404, -32001, 'Session not found. Re-initialize.');
        session.lastSeen = Date.now();
        return await session.transport.handleRequest(req, res, req.body);
      }
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        return rpcError(res, 400, -32000, 'Bad request: missing mcp-session-id header (send initialize first).');
      }
      const server = createMcpServer({ store });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, { transport, server, lastSeen: Date.now() }),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
        server.close();
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
    }
  };

  return { guard: [hostHeaderValidation(allowed), auth], handle, sessions };
}
