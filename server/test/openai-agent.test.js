// OpenAI-compatible provider tests (Groq, OpenRouter, Gemini, Ollama...)
// against a LOCAL MOCK of the Chat Completions API. They verify our request
// shape, the tool-call loop and the fallbacks. They do NOT test how any real
// model chooses tools; that needs a real key for the chosen provider.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../src/store.js';
import { handleChat, providerInfo } from '../src/agent/index.js';

const TODAY = '2026-10-22';
let mock;
let mockURL;
let store;
let script = [];
const requests = [];

const reply = (content) => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
const toolCalls = (...calls) => ({
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: calls.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })),
      },
    },
  ],
});
const lastToolMessages = (body) => body.messages.filter((m) => m.role === 'tool');

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
      res.end(JSON.stringify(out?.body ?? { error: { message: 'mock script exhausted' } }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  mockURL = `http://127.0.0.1:${mock.address().port}/v1`;
  delete process.env.ANTHROPIC_API_KEY;
  store = new Store(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-llm-')), 'db.json'));
});

after(() => mock.close());

beforeEach(() => {
  requests.length = 0;
  for (const k of ['AI_PROVIDER', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY']) delete process.env[k];
});

function useGroqMock() {
  process.env.AI_PROVIDER = 'groq';
  process.env.LLM_API_KEY = 'mock-groq-key-local-only';
  process.env.LLM_BASE_URL = mockURL;
}

test('presets: defaults, overrides and missing configuration', () => {
  process.env.AI_PROVIDER = 'groq';
  assert.equal(providerInfo().provider, 'local');
  assert.match(providerInfo().warning, /groq needs LLM_API_KEY/);

  process.env.LLM_API_KEY = 'x';
  assert.deepEqual(providerInfo(), { provider: 'llm', name: 'groq', label: 'Groq (openai/gpt-oss-120b)', model: 'openai/gpt-oss-120b' });

  process.env.AI_PROVIDER = 'openrouter';
  assert.match(providerInfo().warning, /needs LLM_MODEL/);
  process.env.LLM_MODEL = 'some/model:free';
  assert.equal(providerInfo().label, 'OpenRouter (some/model:free)');

  delete process.env.LLM_API_KEY;
  delete process.env.LLM_MODEL;
  process.env.AI_PROVIDER = 'ollama';
  assert.match(providerInfo().warning, /needs LLM_MODEL$|needs LLM_MODEL\./);
  process.env.LLM_MODEL = 'qwen3';
  assert.equal(providerInfo().provider, 'llm', 'Ollama needs no key');

  process.env.AI_PROVIDER = 'gemini';
  process.env.LLM_API_KEY = 'x';
  delete process.env.LLM_MODEL;
  assert.equal(providerInfo().label, 'Gemini (gemini-2.5-flash)');

  process.env.AI_PROVIDER = 'nonsense';
  assert.match(providerInfo().warning, /Unknown AI_PROVIDER/);
});

test('request shape: endpoint, bearer key, model, system date, function tools, tool_choice auto', async () => {
  useGroqMock();
  script = [{ body: reply('Hi! How can I help?') }];
  const out = await handleChat({ message: 'hi', store, today: TODAY });
  assert.equal(out.reply, 'Hi! How can I help?');
  assert.equal(out.provider.label, 'Groq (openai/gpt-oss-120b)');
  const [req] = requests;
  assert.equal(req.url, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer mock-groq-key-local-only');
  assert.equal(req.body.model, 'openai/gpt-oss-120b');
  assert.equal(req.body.tool_choice, 'auto');
  assert.equal(req.body.messages[0].role, 'system');
  assert.match(req.body.messages[0].content, /Current date: 2026-10-22 \(thursday\)/);
  assert.equal(req.body.tools.length, 8);
  for (const t of req.body.tools) {
    assert.equal(t.type, 'function');
    assert.equal(t.function.parameters.type, 'object', t.function.name);
  }
});

test('four example flows + plan change run real tools through the loop', async () => {
  useGroqMock();
  script = [
    { body: toolCalls(['c1', 'createTask', { title: 'Revise binary trees', dueDate: 'tomorrow' }]) },
    (body) => {
      const [toolMsg] = lastToolMessages(body);
      assert.equal(toolMsg.tool_call_id, 'c1');
      assert.equal(JSON.parse(toolMsg.content).status, 'success');
      const assistant = body.messages.find((m) => m.role === 'assistant' && m.tool_calls);
      assert.equal(assistant.tool_calls[0].function.name, 'createTask');
      return { body: reply('Added Revise binary trees for tomorrow.') };
    },
  ];
  const created = await handleChat({ message: 'Create a task to revise binary trees tomorrow', store, today: TODAY });
  assert.equal(created.actions[0].status, 'success');
  assert.equal(created.actions[0].provider, 'groq:openai/gpt-oss-120b');
  assert.equal(created.actions[0].result.task.dueDate, '2026-10-23');

  script = [{ body: toolCalls(['c2', 'listTasks', { status: 'pending' }]) }, { body: reply('One pending task.') }];
  const listed = await handleChat({ message: 'Show my pending tasks', store, today: TODAY });
  assert.deepEqual(listed.actions[0].result.tasks.map((t) => t.title), ['Revise binary trees']);

  script = [
    { body: toolCalls(['c3', 'generateStudyPlan', { date: '2026-10-23', sessions: [{ topic: 'Graph algorithms', minutes: 120 }, { topic: 'Dynamic programming', minutes: 60 }] }]) },
    { body: reply('Plan saved.') },
  ];
  await handleChat({ message: 'Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming', store, today: TODAY });
  assert.equal(store.getPlanByDate('2026-10-23').endTime, '12:20');

  script = [{ body: toolCalls(['c4', 'updateStudyPlan', { date: '2026-10-23', addSessions: [{ topic: 'Recursion', minutes: 30 }] }]) }, { body: reply('Added recursion.') }];
  await handleChat({ message: "Add 30 minutes of recursion to tomorrow's plan", store, today: TODAY });
  assert.equal(store.getPlanByDate('2026-10-23').studyMinutes, 210);

  // Parallel tool calls in one assistant turn: each gets its own tool message.
  script = [
    { body: toolCalls(['c5', 'completeTask', { taskQuery: 'binary trees' }], ['c6', 'getDailySummary', {}]) },
    (body) => {
      assert.deepEqual(lastToolMessages(body).slice(-2).map((m) => m.tool_call_id), ['c5', 'c6']);
      return { body: reply('Completed and summarized.') };
    },
  ];
  const done = await handleChat({ message: 'Mark binary trees complete and summarize my day', store, today: TODAY });
  assert.deepEqual(done.actions.map((a) => `${a.tool}:${a.status}`), ['completeTask:success', 'getDailySummary:success']);
  assert.equal(store.listTasks({ status: 'completed' }).length, 1);
});

test('invalid JSON arguments are logged as errors and reported back, not executed', async () => {
  useGroqMock();
  const before = store.listTasks().length;
  script = [
    { body: toolCalls(['c7', 'createTask', '{"title": "Broken"']) },
    (body) => {
      const [toolMsg] = lastToolMessages(body);
      assert.equal(JSON.parse(toolMsg.content).status, 'error');
      return { body: reply('Sorry, something went wrong with that request.') };
    },
  ];
  const out = await handleChat({ message: 'Add a task broken', store, today: TODAY });
  assert.equal(out.actions[0].status, 'error');
  assert.match(out.actions[0].error, /not a valid JSON object/);
  assert.equal(store.listTasks().length, before);
});

test('destructive tools still require confirmation through this provider', async () => {
  useGroqMock();
  script = [{ body: toolCalls(['c8', 'deleteTask', { taskQuery: 'binary trees' }]) }, { body: reply('Please confirm in the app.') }];
  const out = await handleChat({ message: 'Delete binary trees', store, today: TODAY });
  assert.equal(out.actions[0].status, 'awaiting_confirmation');
  assert.ok(store.listTasks().some((t) => t.title === 'Revise binary trees'));
});

test('HTTP errors and unreachable servers fall back to the offline engine with a notice', async () => {
  useGroqMock();
  script = [{ status: 401, body: { error: { message: 'Invalid API Key' } } }];
  const unauthorized = await handleChat({ message: 'Show my pending tasks', store, today: TODAY });
  assert.equal(unauthorized.provider.provider, 'local');
  assert.match(unauthorized.notice, /Groq API error \(401\): Invalid API Key/);
  assert.equal(unauthorized.actions[0].tool, 'listTasks');

  process.env.AI_PROVIDER = 'ollama';
  process.env.LLM_MODEL = 'qwen3';
  process.env.LLM_BASE_URL = 'http://127.0.0.1:9/v1'; // nothing listens on port 9
  const unreachable = await handleChat({ message: 'Show my pending tasks', store, today: TODAY });
  assert.match(unreachable.notice, /Ollama API error \(network\): cannot reach/);
  assert.equal(unreachable.actions[0].status, 'success');
});

test('Ollama sends no Authorization header when no key is configured', async () => {
  process.env.AI_PROVIDER = 'ollama';
  process.env.LLM_MODEL = 'qwen3';
  process.env.LLM_BASE_URL = mockURL;
  script = [{ body: reply('Hello from a local model.') }];
  const out = await handleChat({ message: 'hi', store, today: TODAY });
  assert.equal(out.reply, 'Hello from a local model.');
  assert.equal(requests[0].headers.authorization, undefined);
});
