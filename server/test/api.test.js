// End-to-end API tests against a real server on an ephemeral port with a
// temporary data file. Uses the offline engine so no API key is needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import { toolJsonSchemas } from '../src/tools.js';
import { setGatewayUrl } from '../src/agent/gateway.js';
import { stripInvocation } from '../src/agent/index.js';

process.env.AI_PROVIDER = 'local';
const TODAY = '2026-10-22';
const TOMORROW = '2026-10-23';

let server;
let base;
let dataFile;

before(async () => {
  dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-')), 'db.json');
  const app = createApp({ store: new Store(dataFile) });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  // Like the real app: the assistant reaches the tools over Streamable HTTP MCP.
  setGatewayUrl(`${base}/mcp`);
});

after(() => server.close());

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify({ today: TODAY, ...body }) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const chat = (message) => call('POST', '/api/chat', { message });

test('scenario 1: "Create a task to revise binary trees tomorrow" saves a task', async () => {
  const { status, body } = await chat('Create a task to revise binary trees tomorrow');
  assert.equal(status, 200);
  assert.equal(body.actions.length, 1);
  const [action] = body.actions;
  assert.equal(action.tool, 'createTask');
  assert.equal(action.status, 'success');
  assert.equal(action.result.task.title, 'Revise binary trees');
  assert.equal(action.result.task.dueDate, TOMORROW);

  const list = await call('GET', '/api/tasks');
  assert.ok(list.body.tasks.some((t) => t.id === action.result.task.id));
});

test('scenario 2: "Show my pending tasks" returns database records', async () => {
  await chat('Add a task to finish graph revision on friday with high priority');
  const { body } = await chat('Show my pending tasks');
  const [action] = body.actions;
  assert.equal(action.tool, 'listTasks');
  assert.equal(action.status, 'success');
  assert.deepEqual(action.result.tasks.map((t) => t.title).sort(), ['Finish graph revision', 'Revise binary trees']);
  const graph = action.result.tasks.find((t) => t.title === 'Finish graph revision');
  assert.equal(graph.priority, 'high');
  assert.equal(graph.dueDate, '2026-10-23'); // friday after Thursday 2026-10-22
});

test('scenario 3: study plan is generated, scheduled and saved', async () => {
  const { body } = await chat('Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming');
  const [action] = body.actions;
  assert.equal(action.tool, 'generateStudyPlan');
  assert.equal(action.status, 'success');
  const { plan } = action.result;
  assert.equal(plan.date, TOMORROW);
  assert.equal(plan.studyMinutes, 180);
  assert.deepEqual(
    plan.sessions.map((s) => [s.topic, s.minutes]),
    [
      ['Graph Algorithms', 120],
      ['Dynamic Programming', 60],
    ],
  );
  // 2h topic splits into two 60m blocks; breaks between blocks.
  assert.deepEqual(
    plan.blocks.map((b) => `${b.type}:${b.start}-${b.end}`),
    ['study:09:00-10:00', 'break:10:00-10:10', 'study:10:10-11:10', 'break:11:10-11:20', 'study:11:20-12:20'],
  );
  const stored = await call('GET', `/api/plans/${TOMORROW}`);
  assert.equal(stored.body.plan.id, plan.id);
});

test('study plan can be modified by request', async () => {
  const { body } = await chat("Add 30 minutes of recursion to tomorrow's plan");
  const [action] = body.actions;
  assert.equal(action.tool, 'updateStudyPlan');
  assert.equal(action.status, 'success');
  assert.equal(action.result.plan.studyMinutes, 210);

  const r2 = await chat('Remove dynamic programming from the plan');
  assert.equal(r2.body.actions[0].status, 'success');
  assert.deepEqual(r2.body.actions[0].result.plan.sessions.map((s) => s.topic), ['Graph Algorithms', 'Recursion']);

  const r3 = await chat('Start the plan at 2pm');
  assert.equal(r3.body.actions[0].result.plan.startTime, '14:00');
});

test('regenerating an existing plan requires confirmation', async () => {
  const { body } = await chat('Create a study plan for tomorrow with 1 hour of tries');
  const [action] = body.actions;
  assert.equal(action.status, 'awaiting_confirmation');
  const before = await call('GET', `/api/plans/${TOMORROW}`);
  assert.notEqual(before.body.plan.sessions[0].topic, 'Tries');

  const confirmed = await call('POST', `/api/actions/${action.id}/confirm`, {});
  assert.equal(confirmed.body.action.status, 'success');
  const after = await call('GET', `/api/plans/${TOMORROW}`);
  assert.deepEqual(after.body.plan.sessions.map((s) => s.topic), ['Tries']);
});

test('scenario 4: "Mark graph revision complete" completes the right task', async () => {
  const { body } = await chat('Mark graph revision complete');
  const [action] = body.actions;
  assert.equal(action.tool, 'completeTask');
  assert.equal(action.status, 'success');
  assert.equal(action.result.task.title, 'Finish graph revision');
  assert.equal(action.result.task.status, 'completed');

  const pending = await call('GET', '/api/tasks?status=pending');
  assert.deepEqual(pending.body.tasks.map((t) => t.title), ['Revise binary trees']);
});

test('updateTask edits title, due date and priority', async () => {
  const r1 = await chat('Move binary trees to monday');
  assert.equal(r1.body.actions[0].result.task.dueDate, '2026-10-26');
  const r2 = await chat('Make binary trees high priority');
  assert.equal(r2.body.actions[0].result.task.priority, 'high');
  const r3 = await chat('Rename binary trees to Revise AVL and binary trees');
  assert.equal(r3.body.actions[0].result.task.title, 'Revise AVL and binary trees');
});

test('getDailySummary reports real counts', async () => {
  const { body } = await chat('Give me my daily summary for tomorrow');
  const [action] = body.actions;
  assert.equal(action.tool, 'getDailySummary');
  assert.equal(action.result.date, TOMORROW);
  assert.equal(action.result.plan.date, TOMORROW);
});

test('deleting a task asks for confirmation and can be cancelled', async () => {
  const created = await call('POST', '/api/tasks', { title: 'Temporary task' });
  assert.equal(created.status, 201);
  const { body } = await chat('Delete temporary task');
  const [action] = body.actions;
  assert.equal(action.status, 'awaiting_confirmation');
  const cancelled = await call('POST', `/api/actions/${action.id}/cancel`, {});
  assert.equal(cancelled.body.action.status, 'cancelled');
  const tasks = await call('GET', '/api/tasks');
  assert.ok(tasks.body.tasks.some((t) => t.title === 'Temporary task'));
  // A second confirm on a resolved action is rejected.
  const again = await call('POST', `/api/actions/${action.id}/confirm`, {});
  assert.equal(again.status, 400);
});

test('validation rejects bad arguments and unknown tasks', async () => {
  const bad = await call('POST', '/api/tasks', { title: '', priority: 'urgent' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.action.status, 'error');
  assert.match(bad.body.action.error, /title/);
  assert.match(bad.body.action.error, /priority/);

  const badDate = await call('POST', '/api/tasks', { title: 'x', dueDate: '2026-02-30' });
  assert.equal(badDate.status, 400);

  const missing = await chat('Mark quantum chromodynamics complete');
  assert.equal(missing.body.actions[0].status, 'error');
  assert.match(missing.body.reply, /couldn't find/);

  const emptyChat = await call('POST', '/api/chat', { message: '   ' });
  assert.equal(emptyChat.status, 400);
});

test('ambiguous task references return candidates instead of guessing', async () => {
  await call('POST', '/api/tasks', { title: 'Read chapter 3' });
  await call('POST', '/api/tasks', { title: 'Read chapter 4' });
  const { body } = await chat('Complete read chapter');
  assert.equal(body.actions[0].status, 'error');
  assert.equal(body.actions[0].result.candidates.length, 2);
});

test('every action is logged for transparency', async () => {
  const { body } = await call('GET', '/api/actions');
  assert.ok(body.actions.length >= 10);
  for (const a of body.actions) {
    assert.ok(a.tool && a.status && a.createdAt);
  }
});

test('data persists across a restart (new Store on the same file)', () => {
  const reloaded = new Store(dataFile);
  assert.ok(reloaded.listTasks().some((t) => t.title === 'Revise AVL and binary trees'));
  assert.ok(reloaded.getPlanByDate(TOMORROW));
});

test('Alexa+ simulator: assistant tool calls travel over MCP Streamable HTTP', async () => {
  const { body } = await chat('Alexa, ask Jarvis to add a task to review heaps tomorrow');
  assert.deepEqual(body.mcp, { transport: 'streamable-http', toolsDiscovered: 8 });
  const [action] = body.actions;
  assert.equal(action.tool, 'createTask');
  assert.equal(action.status, 'success');
  assert.equal(action.via, 'mcp');
  assert.equal(action.source, 'assistant');
  assert.equal(action.provider, 'local');
  assert.equal(action.request, 'add a task to review heaps tomorrow');
  assert.equal(action.result.task.title, 'Review heaps');
  assert.equal(action.result.task.dueDate, TOMORROW, 'client date passed through MCP _meta');
});

test('invocation phrases are stripped the way Alexa+ hands off to an integration', () => {
  assert.equal(stripInvocation('Alexa, ask Jarvis to show my pending tasks'), 'show my pending tasks');
  assert.equal(stripInvocation('alexa tell jarvis lifeos mark heaps complete'), 'mark heaps complete');
  assert.equal(stripInvocation('Hey Alexa, show my tasks'), 'show my tasks');
  assert.equal(stripInvocation('Jarvis, what is my daily summary?'), 'what is my daily summary?');
  assert.equal(stripInvocation('Show my pending tasks'), 'Show my pending tasks');
});

test('GET /api/mcp describes the server using live MCP discovery', async () => {
  const { status, body } = await call('GET', '/api/mcp');
  assert.equal(status, 200);
  assert.equal(body.protocolVersion, '2025-11-25');
  assert.equal(body.transport, 'streamable-http');
  assert.equal(body.simulatorTransport, 'streamable-http');
  assert.match(body.endpoint, /\/mcp$/);
  assert.equal(body.tools.length, 8);
  assert.equal(body.tools.find((t) => t.name === 'deleteTask').annotations.destructiveHint, true);
  assert.ok(body.mcpCalls > 0);
});

test('tool JSON schemas are generated for the LLM', () => {
  const schemas = toolJsonSchemas();
  const names = schemas.map((s) => s.name);
  for (const n of ['createTask', 'listTasks', 'updateTask', 'completeTask', 'generateStudyPlan', 'updateStudyPlan', 'getDailySummary']) {
    assert.ok(names.includes(n), n);
  }
  const create = schemas.find((s) => s.name === 'createTask');
  assert.equal(create.input_schema.type, 'object');
  assert.deepEqual(create.input_schema.required, ['title']);
});
