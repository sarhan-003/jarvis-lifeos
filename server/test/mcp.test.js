// MCP server tests: a real MCP SDK client talks to /mcp over Streamable HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';

let server;
let base;
let store;

function listen(app) {
  return new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
}

before(async () => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-')), 'db.json');
  store = new Store(dataFile);
  server = await listen(createApp({ store }));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function connect({ elicit, headers } = {}) {
  const client = new Client({ name: 'jarvis-test-client', version: '1.0.0' }, { capabilities: elicit ? { elicitation: { form: {} } } : {} });
  if (elicit) client.setRequestHandler(ElicitRequestSchema, elicit);
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }));
  return client;
}

const rpcInit = (protocolVersion) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'raw', version: '1' } },
});

function rawRequest({ method = 'POST', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/mcp`, { method, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('initialize negotiates protocol version 2025-11-25 over Streamable HTTP', async () => {
  const res = await rawRequest({ body: rpcInit('2025-11-25') });
  assert.equal(res.status, 200);
  // Streamable HTTP may answer with JSON or an SSE stream; extract the JSON-RPC message.
  const json = JSON.parse(res.headers['content-type'].includes('text/event-stream') ? res.body.match(/^data: (.+)$/m)[1] : res.body);
  assert.equal(json.result.protocolVersion, '2025-11-25');
  assert.equal(json.result.serverInfo.name, 'jarvis-lifeos');
  assert.ok(json.result.capabilities.tools);
});

test('tools/list exposes every Jarvis tool with schemas and annotations', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['completeTask', 'createTask', 'deleteTask', 'generateStudyPlan', 'getDailySummary', 'listTasks', 'updateStudyPlan', 'updateTask']);
  const create = tools.find((t) => t.name === 'createTask');
  assert.equal(create.inputSchema.type, 'object');
  assert.deepEqual(create.inputSchema.required, ['title']);
  assert.equal(tools.find((t) => t.name === 'listTasks').annotations.readOnlyHint, true);
  assert.equal(tools.find((t) => t.name === 'deleteTask').annotations.destructiveHint, true);
  await client.close();
});

test('tools/call performs real operations visible to the web app', async () => {
  const client = await connect();
  const created = await client.callTool({ name: 'createTask', arguments: { title: 'Revise heaps', dueDate: 'tomorrow', priority: 'high' } });
  assert.equal(created.isError, false);
  assert.equal(created.structuredContent.status, 'success');
  const task = created.structuredContent.result.task;
  assert.equal(task.title, 'Revise heaps');
  assert.match(task.dueDate, /^\d{4}-\d{2}-\d{2}$/);

  const listed = await client.callTool({ name: 'listTasks', arguments: { status: 'pending' } });
  assert.ok(listed.structuredContent.result.tasks.some((t) => t.id === task.id));

  const plan = await client.callTool({
    name: 'generateStudyPlan',
    arguments: { date: '2030-01-15', sessions: [{ topic: 'Heaps', minutes: 90 }], startTime: '18:00' },
  });
  assert.equal(plan.structuredContent.status, 'success');
  assert.equal(plan.structuredContent.result.plan.endTime, '19:40');

  const done = await client.callTool({ name: 'completeTask', arguments: { taskQuery: 'heaps' } });
  assert.equal(done.structuredContent.result.task.status, 'completed');

  // Same store as the REST API, and the action log records the MCP source.
  const rest = await fetch(`${base}/api/tasks?status=completed`).then((r) => r.json());
  assert.ok(rest.tasks.some((t) => t.id === task.id));
  const log = await fetch(`${base}/api/actions`).then((r) => r.json());
  assert.ok(log.actions.filter((a) => a.source === 'mcp').length >= 4);
  await client.close();
});

test('invalid arguments and unknown tools return MCP tool errors', async () => {
  const client = await connect();
  const bad = await client.callTool({ name: 'createTask', arguments: { title: '', priority: 'urgent' } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Invalid arguments/);
  const unknown = await client.callTool({ name: 'launchRocket', arguments: {} });
  assert.equal(unknown.isError, true);
  await client.close();
});

test('destructive tools wait for confirmation when the client cannot elicit', async () => {
  const client = await connect();
  await client.callTool({ name: 'createTask', arguments: { title: 'Scratch note' } });
  const res = await client.callTool({ name: 'deleteTask', arguments: { taskQuery: 'scratch note' } });
  assert.equal(res.structuredContent.status, 'awaiting_confirmation');
  assert.ok(store.listTasks().some((t) => t.title === 'Scratch note'));
  await client.close();
});

test('destructive tools ask the user via elicitation and respect the answer', async () => {
  const prompts = [];
  let answer = { action: 'decline' };
  const client = await connect({
    elicit: async (req) => {
      prompts.push(req.params.message);
      return answer;
    },
  });
  await client.callTool({ name: 'createTask', arguments: { title: 'Old flashcards' } });

  const declined = await client.callTool({ name: 'deleteTask', arguments: { taskQuery: 'old flashcards' } });
  assert.equal(declined.structuredContent.status, 'cancelled');
  assert.ok(store.listTasks().some((t) => t.title === 'Old flashcards'));

  answer = { action: 'accept', content: { confirm: true } };
  const accepted = await client.callTool({ name: 'deleteTask', arguments: { taskQuery: 'old flashcards' } });
  assert.equal(accepted.structuredContent.status, 'success');
  assert.ok(!store.listTasks().some((t) => t.title === 'Old flashcards'));
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Delete task "Old flashcards"/);
  await client.close();
});

test('DNS rebinding protection rejects foreign Host and Origin headers', async () => {
  const badHost = await rawRequest({ headers: { host: 'evil.example' }, body: rpcInit('2025-11-25') });
  assert.equal(badHost.status, 403);
  const badOrigin = await rawRequest({ headers: { origin: 'https://evil.example' }, body: rpcInit('2025-11-25') });
  assert.equal(badOrigin.status, 403);
  const localOrigin = await rawRequest({ headers: { origin: 'http://localhost:5173' }, body: rpcInit('2025-11-25') });
  assert.equal(localOrigin.status, 200);
});

test('sessions: non-initialize requests need a session id, unknown ids get 404, DELETE ends a session', async () => {
  const noSession = await rawRequest({ body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  assert.equal(noSession.status, 400);
  const unknown = await rawRequest({ headers: { 'mcp-session-id': 'nope' }, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  assert.equal(unknown.status, 404);

  const init = await rawRequest({ body: rpcInit('2025-11-25') });
  const sessionId = init.headers['mcp-session-id'];
  assert.ok(sessionId);
  const ended = await rawRequest({ method: 'DELETE', headers: { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' } });
  assert.equal(ended.status, 200);
  const after = await rawRequest({ headers: { 'mcp-session-id': sessionId }, body: { jsonrpc: '2.0', id: 3, method: 'tools/list' } });
  assert.equal(after.status, 404);
});

test('MCP_AUTH_TOKEN requires a bearer token', async () => {
  process.env.MCP_AUTH_TOKEN = 'test-secret';
  const secured = await listen(createApp({ store }));
  delete process.env.MCP_AUTH_TOKEN;
  const url = new URL(`http://127.0.0.1:${secured.address().port}/mcp`);
  try {
    const anon = new Client({ name: 'anon', version: '1' });
    await assert.rejects(anon.connect(new StreamableHTTPClientTransport(url)));

    const authed = new Client({ name: 'authed', version: '1' });
    await authed.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: 'Bearer test-secret' } } }));
    const { tools } = await authed.listTools();
    assert.equal(tools.length, 8);
    await authed.close();
  } finally {
    secured.close();
  }
});
