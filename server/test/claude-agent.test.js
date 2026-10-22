// Claude agent loop tests against a LOCAL MOCK of the Messages API.
// These verify our side of the integration (request shape, tool-call loop,
// tool_result handling, confirmation and error fallback). They do NOT test
// how the real Claude model chooses tools; that needs a real API key.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../src/store.js';

const TODAY = '2026-10-22';
let mock;
let store;
let script = []; // queued responses: { status?, body } or (request) => response
const requests = [];
let handleChat;

function message(content, stop_reason) {
  return { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } };
}
const toolUse = (id, name, input) => message([{ type: 'tool_use', id, name, input }], 'tool_use');
const text = (t) => message([{ type: 'text', text: t }], 'end_turn');

before(async () => {
  mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ url: req.url, headers: req.headers, body });
      const next = script.shift();
      const out = typeof next === 'function' ? next(body) : next;
      res.writeHead(out?.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out?.body ?? { type: 'error', error: { type: 'api_error', message: 'mock script exhausted' } }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'mock-key-local-only';
  delete process.env.AI_PROVIDER;
  ({ handleChat } = await import('../src/agent/index.js'));
  store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-claude-')), 'db.json'));
});

after(() => mock.close());

const lastToolResult = (body) => body.messages.at(-1).content.find((b) => b.type === 'tool_result');

test('request shape: model, system date, all tools with JSON Schemas, low effort', async () => {
  requests.length = 0;
  script = [{ body: text('Hello! How can I help?') }];
  const out = await handleChat({ message: 'hi', store, today: TODAY });
  assert.equal(out.reply, 'Hello! How can I help?');
  assert.equal(out.provider.provider, 'anthropic');
  const [req] = requests;
  assert.equal(req.url, '/v1/messages');
  assert.equal(req.headers['x-api-key'], 'mock-key-local-only');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.match(req.body.system, /Current date: 2026-10-22 \(thursday\)/);
  assert.deepEqual(req.body.output_config, { effort: 'low' });
  assert.equal(req.body.tools.length, 8);
  for (const t of req.body.tools) {
    assert.equal(t.input_schema.type, 'object', t.name);
    assert.ok(t.description, t.name);
    assert.ok(!('$schema' in t.input_schema), t.name);
  }
  assert.deepEqual(req.body.messages, [{ role: 'user', content: 'hi' }]);
});

test('scenario 1 via agent loop: tool_use createTask is executed and its result fed back', async () => {
  requests.length = 0;
  script = [
    { body: toolUse('tu_1', 'createTask', { title: 'Revise binary trees', dueDate: 'tomorrow' }) },
    (body) => {
      const result = lastToolResult(body);
      assert.equal(result.tool_use_id, 'tu_1');
      assert.equal(JSON.parse(result.content).status, 'success');
      return { body: text('Done, I added "Revise binary trees" for tomorrow.') };
    },
  ];
  const out = await handleChat({ message: 'Create a task to revise binary trees tomorrow', store, today: TODAY });
  assert.equal(out.actions.length, 1);
  assert.equal(out.actions[0].status, 'success');
  assert.equal(out.actions[0].provider, 'claude:claude-opus-5-5');
  assert.equal(out.actions[0].result.task.dueDate, '2026-10-23');
  assert.match(out.reply, /Revise binary trees/);
  assert.ok(store.listTasks().some((t) => t.title === 'Revise binary trees'));
  // Second request carries the assistant tool_use turn, then the tool_result.
  const second = requests[1].body.messages;
  assert.equal(second.at(-2).role, 'assistant');
  assert.equal(second.at(-2).content[0].type, 'tool_use');
});

test('scenarios 2-4 + plan change: multi-step and parallel tool calls run against real data', async () => {
  script = [
    { body: toolUse('tu_2', 'listTasks', { status: 'pending' }) },
    (body) => {
      const r = JSON.parse(lastToolResult(body).content);
      assert.deepEqual(r.result.tasks.map((t) => t.title), ['Revise binary trees']);
      return { body: text('You have one pending task: Revise binary trees.') };
    },
  ];
  const list = await handleChat({ message: 'Show my pending tasks', store, today: TODAY });
  assert.equal(list.actions[0].tool, 'listTasks');

  script = [
    {
      body: toolUse('tu_3', 'generateStudyPlan', {
        date: '2026-10-23',
        sessions: [
          { topic: 'Graph algorithms', minutes: 120 },
          { topic: 'Dynamic programming', minutes: 60 },
        ],
      }),
    },
    { body: text('Your plan for tomorrow runs 09:00 to 12:20.') },
  ];
  const plan = await handleChat({ message: 'Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming', store, today: TODAY });
  assert.equal(plan.actions[0].status, 'success');
  assert.equal(store.getPlanByDate('2026-10-23').endTime, '12:20');

  script = [
    { body: toolUse('tu_4', 'updateStudyPlan', { date: '2026-10-23', addSessions: [{ topic: 'Recursion', minutes: 30 }] }) },
    { body: text('Added 30 minutes of recursion.') },
  ];
  const change = await handleChat({ message: "Add 30 minutes of recursion to tomorrow's plan", store, today: TODAY });
  assert.equal(change.actions[0].status, 'success');
  assert.equal(store.getPlanByDate('2026-10-23').studyMinutes, 210);

  // Parallel tool use: two tool_use blocks in one turn, both results in ONE user message.
  script = [
    {
      body: message(
        [
          { type: 'tool_use', id: 'tu_5', name: 'completeTask', input: { taskQuery: 'binary trees' } },
          { type: 'tool_use', id: 'tu_6', name: 'getDailySummary', input: {} },
        ],
        'tool_use',
      ),
    },
    (body) => {
      const results = body.messages.at(-1).content;
      assert.deepEqual(results.map((b) => b.tool_use_id), ['tu_5', 'tu_6']);
      return { body: text('Marked it complete.') };
    },
  ];
  const done = await handleChat({ message: 'Mark binary trees complete and give me my summary', store, today: TODAY });
  assert.deepEqual(done.actions.map((a) => `${a.tool}:${a.status}`), ['completeTask:success', 'getDailySummary:success']);
  assert.equal(store.listTasks({ status: 'completed' }).length, 1);
});

test('tool errors and confirmations are reported back to Claude correctly', async () => {
  script = [
    { body: toolUse('tu_7', 'completeTask', { taskQuery: 'quantum chromodynamics' }) },
    (body) => {
      const r = lastToolResult(body);
      assert.equal(r.is_error, true);
      assert.match(JSON.parse(r.content).error, /couldn't find/);
      return { body: text("I couldn't find that task.") };
    },
  ];
  const missing = await handleChat({ message: 'Complete quantum chromodynamics', store, today: TODAY });
  assert.equal(missing.actions[0].status, 'error');

  script = [
    { body: toolUse('tu_8', 'deleteTask', { taskQuery: 'binary trees' }) },
    (body) => {
      const r = lastToolResult(body);
      assert.equal(r.is_error, false);
      assert.equal(JSON.parse(r.content).status, 'awaiting_confirmation');
      return { body: text('Please confirm the deletion in the app.') };
    },
  ];
  const del = await handleChat({ message: 'Delete binary trees', store, today: TODAY });
  assert.equal(del.actions[0].status, 'awaiting_confirmation');
  assert.ok(store.listTasks().some((t) => t.title === 'Revise binary trees'), 'nothing deleted before confirmation');
});

test('history is normalized to alternate roles and start with a user turn', async () => {
  requests.length = 0;
  script = [{ body: text('Sure.') }];
  await handleChat({
    message: 'and tomorrow?',
    history: [
      { role: 'assistant', text: 'Welcome!' },
      { role: 'user', text: 'show tasks' },
      { role: 'user', text: 'pending only' },
      { role: 'assistant', text: 'You have one.' },
    ],
    store,
    today: TODAY,
  });
  const roles = requests[0].body.messages.map((m) => m.role);
  assert.deepEqual(roles, ['user', 'assistant', 'user']);
  assert.equal(requests[0].body.messages[0].content, 'show tasks\npending only');
});

test('refusal and API errors are handled: refusal message, offline fallback with notice', async () => {
  script = [{ body: message([], 'refusal') }];
  const refused = await handleChat({ message: 'something disallowed', store, today: TODAY });
  assert.match(refused.reply, /can't help/);
  assert.equal(refused.actions.length, 0);

  script = [{ status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'bad request from mock' } } }];
  const failed = await handleChat({ message: 'Show my pending tasks', store, today: TODAY });
  assert.equal(failed.provider.provider, 'local');
  assert.match(failed.notice, /Claude API error \(400\)/);
  assert.equal(failed.actions[0].tool, 'listTasks');
  assert.equal(failed.actions[0].status, 'success');
});
