# Jarvis LifeOS

**A study and productivity integration for Alexa+, built the way Alexa+ brand integrations are built: as a self-hosted MCP server.** Made for the Amazon Developer "Build, Ship, Shape" hackathon, Alexa+ track.

The track asks for a self-hosted MCP server (spec 2025-11-25 or later, Streamable HTTP), with a simulated Alexa+ experience in a web app as the alternative. This project does both, and connects them:

1. **The Jarvis LifeOS MCP server** at `/mcp` (spec **2025-11-25**, **Streamable HTTP**). It exposes 8 tools for tasks, study plans and daily summaries to any MCP client.
2. **An Alexa+ simulator** in the web app. You speak or type ("Alexa, ask Jarvis to create a study plan for tomorrow…"), and an AI agent does what Alexa+ does with a brand integration:
   - connects to the Jarvis MCP server
   - discovers the tools with `tools/list`
   - runs them with `tools/call`
   - speaks the result

   Every reply shows that path: `You → Alexa+ sim · engine → MCP Streamable HTTP → tools/call createTask → result`.

```
 🎙 "Alexa, ask Jarvis to…"   ┌────────────────────────┐  MCP (Streamable HTTP)  ┌──────────────────────────────┐
 ───────────────────────────▶ │ Alexa+ simulator agent │ ──── tools/list ──────▶ │ Jarvis LifeOS MCP server     │
 🔊 spoken reply  ◀────────── │ Gemini / Groq / Claude │ ──── tools/call ──────▶ │ 8 tools · validation ·       │
                              │ or offline engine      │ ◀─── results ────────── │ confirmation · JSON store    │
                              └────────────────────────┘                         └──────────────────────────────┘
                                                        any other MCP client ──▶  (MCP Inspector, Claude Desktop…)
```

The AI engine can be a **free** LLM (Groq or Gemini free tier, OpenRouter free models, or Ollama locally), Claude, or a built-in offline engine that needs no key.

> **Honest scope:** this has not been connected to the real Alexa+ service, which requires Amazon's Alexa+ preview onboarding, and it does not run on Alexa devices. The MCP server is real and spec-compliant, tested with the official MCP SDK client and raw HTTP. The Alexa+ experience is a simulation, as the track allows.

## Features

- **Alexa+ simulator.**
  - Voice input with a light ring, spoken replies, and Alexa-style invocation: "Alexa, ask Jarvis to…" is understood and handed to the integration.
  - Every engine (offline, Gemini, Groq, Claude) reaches the tools only through the MCP server, as an MCP client. Each reply shows the MCP trace.
- **MCP server page.** Shows the endpoint, protocol version, transport, auth mode, the live `tools/list` result with annotations, the number of tool calls made over MCP, and how to connect an MCP client.
- **Conversation with voice and text.** Browser speech recognition for input (where supported), speech synthesis for replies, and a text box that always works.
- **Real tool calling.** `createTask`, `listTasks`, `updateTask`, `completeTask`, `deleteTask`, `generateStudyPlan`, `updateStudyPlan` and `getDailySummary`. Each one validates its arguments with zod and changes persisted data. No result is hard-coded.
- **Task management.** Create, list (pending/completed/all), edit title, due date and priority, complete, and delete, from chat or from the Tasks page.
- **Study planner.** "Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming" becomes a timed schedule: focus blocks of at most 60 minutes with breaks between them. The plan is saved, and you can change it ("add 30 minutes of recursion to tomorrow's plan", "remove dynamic programming", "start the plan at 2pm").
- **Tool transparency.** Each assistant reply lists the tool calls it made, with status, the real result, any error, and expandable arguments. The Activity page shows the full log.
- **Confirmation for destructive actions.** Deleting a task, or replacing an existing study plan, waits for an explicit Confirm or Cancel.
- **Choice of AI engine:**
  - **Claude** (Anthropic API, tool use) when `ANTHROPIC_API_KEY` is set.
  - **Free OpenAI-compatible LLMs** through one provider: **Groq**, **Gemini**, **OpenRouter**, **Ollama** (local), or any Chat Completions server. Pick one with `AI_PROVIDER`.
  - **Offline intent engine** when no AI is configured. It is a deterministic rule-based parser that calls the same tools. It understands fewer phrasings, and the UI labels its replies "offline engine".
  - If an LLM call fails, Jarvis falls back to the offline engine and shows the API error.

## MCP server

- **Endpoint:** `POST/GET/DELETE http://localhost:8787/mcp`, Streamable HTTP with sessions (`Mcp-Session-Id`)
- **Protocol:** negotiates `2025-11-25`, the latest version, and falls back to older versions for older clients. Built with `@modelcontextprotocol/sdk` 1.32.
- **Tools:** the same eight tools, with JSON Schemas, titles and annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`). Results include readable `content` and `structuredContent` (`actionId`, `status`, `result`).
- **Human confirmation:** `deleteTask`, and `generateStudyPlan` when it would replace a plan, use **MCP elicitation** to ask the user if the client supports it. Otherwise the action stays pending until someone confirms it in the dashboard.
- **Shared state:** MCP calls write to the same store and appear in the dashboard's Activity log, marked "via MCP".
  - Calls from external clients are tagged "MCP client".
  - Calls from the Alexa+ simulator carry the user's words, engine and calendar date in `_meta` (`jarvis/request`, `jarvis/provider`, `jarvis/today`), so the log shows the whole request.
- **Security:**
  - Host-header and Origin validation protect against DNS rebinding.
  - Set `MCP_AUTH_TOKEN` to require `Authorization: Bearer <token>`. Do this before exposing the server beyond localhost, and add your tunnel hostname to `MCP_ALLOWED_HOSTS`.

**Connect a client.** Run `npm run dev`, then point any Streamable HTTP MCP client at `http://localhost:8787/mcp`. For example, the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Choose transport "Streamable HTTP" and URL `http://localhost:8787/mcp`.

## Setup and running

### 1. Requirements

- **Node.js 22.9 or newer** with npm. The scripts use `node --env-file-if-exists` and `node --test` glob patterns, which older versions lack. We tested on Node 25.9 and npm 11.12 on Windows 10.
- Git.
- For voice input: Chrome or Edge. Typing works in every browser.

Check your versions:

```bash
node -v
```

### 2. Install

From the repository root (an npm workspace with `client/` and `server/`):

```bash
npm install
```

For a clean, reproducible install from the lockfile, use `npm ci` instead.

### 3. Configure the environment (optional)

The app runs with no configuration: it uses the offline intent engine and stores data in `server/data/db.json`. To enable Claude, create `.env` in the repository root.

macOS/Linux/Git Bash:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Then edit `.env` and choose one engine. The server reads `.env` at startup, so restart it after editing. The dashboard footer and `GET /api/health` show the active engine, plus a warning if a setting is missing.

| Engine | Cost | `.env` settings |
|---|---|---|
| Groq | Free tier, no card | `AI_PROVIDER=groq` and `LLM_API_KEY=<key from console.groq.com>`. Default model: `openai/gpt-oss-120b`. |
| Gemini | Free tier (Google may use free-tier prompts to improve its products) | `AI_PROVIDER=gemini` and `LLM_API_KEY=<key from aistudio.google.com>`. Default model: `gemini-2.5-flash`. |
| OpenRouter | Free `:free` models | `AI_PROVIDER=openrouter`, `LLM_API_KEY=...` and `LLM_MODEL=<a model id ending in :free>` |
| Ollama | Free, runs locally | Install Ollama, run `ollama pull <model>`, then set `AI_PROVIDER=ollama` and `LLM_MODEL=<model>` (no key) |
| Claude | Paid | `ANTHROPIC_API_KEY=...` (and leave `AI_PROVIDER` empty or set it to `anthropic`) |

Free-tier model lists change often. If a default model stops working, set `LLM_MODEL` to one listed on the provider's models page.

### 4. Start (development)

```bash
npm run dev
```

This starts both processes:
- Web app: http://localhost:5173. Vite proxies `/api` to the API.
- API and MCP server: http://localhost:8787. MCP endpoint: http://localhost:8787/mcp

### 5. Start (production build)

```bash
npm run build
```

```bash
npm start
```

This serves the built web app, the API and `/mcp` together on http://localhost:8787.

### 6. Test

```bash
npm test
```

Runs 39 tests: REST, the assistant scenarios (with the simulator reaching the tools over real Streamable HTTP MCP), the Claude agent loop and the OpenAI-compatible agent loop (each against a local mock API), and the MCP protocol. Each test uses a temporary data file and its own server on a random port, so it never touches your data and doesn't need a running server, network access or an API key.

### 7. Check the MCP endpoint by hand

With the server running:

```bash
curl -i http://localhost:8787/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

The response carries an `mcp-session-id` header and `"protocolVersion":"2025-11-25"`. Send that header (and `mcp-protocol-version: 2025-11-25`) on later requests such as `tools/list` and `tools/call`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables Claude tool calling. Server-side only, never sent to the browser. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude model id |
| `AI_PROVIDER` | auto | `local`, `anthropic`, `groq`, `gemini`, `openrouter`, `ollama` or `openai-compatible`. Empty means Claude if `ANTHROPIC_API_KEY` is set, otherwise offline. |
| `LLM_API_KEY` | none | Key for the OpenAI-compatible provider (not needed for Ollama). Server-side only. |
| `LLM_MODEL` | preset | Model id; overrides the preset default |
| `LLM_BASE_URL` | preset | Chat Completions base URL; overrides the preset default |
| `API_PORT` | `8787` | API port. If you change it, set it in your shell too so the Vite proxy uses it. |
| `DATA_FILE` | `./data/db.json` | JSON database path, relative to `server/` |
| `MCP_AUTH_TOKEN` | none | When set, `/mcp` requires `Authorization: Bearer <token>` |
| `MCP_ALLOWED_HOSTS` | none | Extra Host names allowed on `/mcp` besides localhost (e.g. a tunnel hostname) |
| `CORS_ORIGINS` | none | Extra browser origins allowed to call the API. Local origins are always allowed. |

## Architecture

```
browser (React + Vite)                     server (Node + Express)
┌──────────────────────────┐   /api/chat   ┌─────────────────────────────────────┐
│ Chat + voice orb         │ ────────────▶ │ agent/index.js  picks the engine    │
│  SpeechRecognition (in)  │               │  ├─ agent/claude.js  Claude tool use │
│  speechSynthesis (out)   │               │  └─ agent/local.js   offline parser │
│ Tasks / Study plan views │  REST /api/*  │            │ tool calls              │
│ Activity log + confirm   │ ◀──────────▶  │ executor.js  validate → confirm? →  │
└──────────────────────────┘               │              run → log action        │
 any MCP client ──── /mcp (Streamable HTTP) ▶│ mcp.js  tools/list, tools/call ──┘   │
                                           │ tools.js     8 tools (zod schemas)  │
                                           │ store.js     JSON file, atomic write│
                                           └─────────────────────────────────────┘
```

- **One tool catalogue** (`server/src/tools.js`) serves Claude, the offline engine and the REST endpoints. The JSON Schemas sent to Claude are generated from the same zod schemas the server validates with, so the two can't drift apart.
- **The executor** (`server/src/executor.js`) normalizes relative dates, validates arguments, asks for confirmation when a tool requires it, runs the tool, and writes an action record for every attempt, including failures.
- **Storage** (`server/src/store.js`) is a JSON file written atomically (temp file, then rename) with serialized writes. We chose it because neither MongoDB nor Firebase was available in the build environment. Everything goes through a small `Store` class, so it can be swapped for MongoDB or Firestore.
- **Dates.** The browser sends its local date with each request, so "tomorrow" means the user's tomorrow, not the server's.

### API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Active AI engine and storage |
| POST | `/api/chat` | `{ message, history?, today? }` → `{ reply, actions[], provider, notice? }` |
| GET | `/api/tasks?status=pending\|completed\|all` | List tasks |
| POST | `/api/tasks` | Create `{ title, dueDate?, priority?, notes? }` |
| PATCH | `/api/tasks/:id` | Edit `{ title?, dueDate?, priority?, notes? }` |
| POST | `/api/tasks/:id/complete` | Complete a task |
| DELETE | `/api/tasks/:id` | Delete (the UI confirms first) |
| GET | `/api/plans`, `/api/plans/:date` | Study plans |
| GET | `/api/summary?date=` | Daily summary |
| GET | `/api/actions` | Tool execution log |
| POST | `/api/actions/:id/confirm` · `/cancel` | Resolve an action awaiting confirmation |
| POST/GET/DELETE | `/mcp` | MCP server (Streamable HTTP, protocol 2025-11-25) |

Mutating endpoints return `{ action }`. An action is `{ id, tool, args, status: success|error|awaiting_confirmation|cancelled, result, message, error, source, provider, request, createdAt }`. Validation failures return 400, unknown tasks return 404, and actions awaiting confirmation return 202.

## Testing

`npm test` starts the real Express app on a random port with a temporary data file and the offline engine. The tests cover:

1. "Create a task to revise binary trees tomorrow": `createTask` runs, the task is saved with tomorrow's date, and it shows up in `/api/tasks`
2. "Show my pending tasks": `listTasks` returns the stored records
3. "Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming": the plan is scheduled (09:00–12:20, 2h topic split into 2 blocks) and saved
4. "Mark graph revision complete": the right task is completed and leaves the pending list

The tests also cover changing a plan by request, the confirmation and cancel flow, task edits, the daily summary, argument validation (empty title, bad enum, impossible date), ambiguous task references (Jarvis returns the candidates instead of guessing), the action log, persistence across a restart, and generation of the tool JSON Schemas.

The MCP tests (`server/test/mcp.test.js`) drive `/mcp` with the official MCP SDK client over Streamable HTTP. They cover:
- `initialize` negotiating `2025-11-25`
- `tools/list` schemas and annotations
- real `tools/call` operations that are visible through the REST API and the action log
- tool errors for invalid arguments and unknown tools
- confirmation, both pending without elicitation and declined or accepted through elicitation
- session rules (400 without a session, 404 for an unknown session, DELETE ending a session)
- Host and Origin rejection
- bearer-token auth

The Claude agent tests (`server/test/claude-agent.test.js`) point the real Anthropic SDK at a **local mock** of the Messages API (`ANTHROPIC_BASE_URL`) that returns scripted responses. They check:
- the request we send: model, system prompt with today's date, all 8 tool JSON Schemas, `output_config.effort`
- the tool loop: `tool_use` is executed and its `tool_result` returned, with several tool calls in one turn sharing one user message
- errors and confirmations reported back to the model
- history normalization
- refusal handling and the fallback to the offline engine on API errors

They do **not** test which tools the real Claude model chooses. That needs a real API key.

The OpenAI-compatible tests (`server/test/openai-agent.test.js`) do the same against a local mock of the Chat Completions API. They check:
- preset defaults, overrides and missing-setting warnings
- the request: endpoint, bearer key, model, system date, function tools, `tool_choice: "auto"`
- the four example flows plus a plan change, and parallel tool calls
- that broken JSON arguments are logged and never executed
- that confirmation is still required
- the fallback on HTTP errors or an unreachable server
- that Ollama sends no `Authorization` header

All 39 tests pass.

We also ran the four scenarios by hand in the browser, plus confirm/cancel, inline task editing, page reload persistence, and desktop and mobile layouts.

### Verification status (2026-10-22, Windows 10, Node 25.9)

**Tested and working:**
- `npm test`: all pass, both in the working copy and in a fresh `git clone` + `npm ci` (23/23 at that point; 29/29 after the Claude agent tests were added).
- `npm run build` + `npm start` from a fresh clone. The built web app, `/api` and `/mcp` are all served together.
- `/mcp` over raw HTTP (curl):
  - `initialize` returns protocol `2025-11-25` and an `mcp-session-id`
  - `notifications/initialized` returns 202
  - `tools/list` returns all 8 tools
  - `tools/call` writes real records to the data file, and invalid arguments return `isError: true`
- MCP persistence across a server restart: a task and plan created over MCP before the restart could be listed, changed and completed after it, and the REST API showed the same records.
- Web app against the production build: the four scenarios, a plan change, and a delete confirmed through the UI, all reflected in the API, with no browser console errors.
- Dev mode: the Vite proxy forwards `/api` correctly. Cross-site browser origins get 403.

**Not verified:**
- **Real Claude tool selection (blocked: no API key on the build machine).** Our side of the integration is covered by the mock-API tests above. With an invalid key, the SDK call reaches the Anthropic API, the 401 is handled, and the offline engine takes over with a visible notice.
- Voice input with a real microphone. Speech output was observed working.
- Third-party MCP clients (MCP Inspector, Claude Desktop) and any connection to Alexa+ itself. MCP was tested with the official `@modelcontextprotocol/sdk` client and with raw HTTP.
- Node versions below 25.9, macOS and Linux.

## Limitations

- On Windows, stopping `npm start` from a parent process (not a terminal Ctrl+C) can leave the child `node` process holding port 8787. Stop it from Task Manager, or run `node src/index.js` in `server/` directly.
- The offline engine only understands the phrasings it was written for. Use Claude for open-ended language.
- Speech recognition depends on the browser: Chrome and Edge support it, Firefox does not. Typing always works.
- Single user and no authentication. The JSON file store suits a demo, not a multi-user deployment.
- Task completion dates use the server's local timezone.

## Project structure

```
client/                 React + Vite dashboard
  src/App.jsx           layout, state, data refresh
  src/components/       Chat, ActionCard, Tasks, Plans
  src/useSpeech.js      speech recognition + synthesis hooks
  src/api.js            API client
server/
  src/index.js          entry point
  src/app.js            Express routes
  src/tools.js          tool catalogue + scheduling
  src/executor.js       validation, confirmation, action log
  src/store.js          JSON-file persistence
  src/dates.js          date helpers
  src/agent/            index.js (engine choice), gateway.js (MCP client), claude.js, openai.js, local.js, prompt.js
  src/mcp.js            MCP server (Streamable HTTP, 2025-11-25)
  test/api.test.js      end-to-end REST + agent tests
  test/mcp.test.js      MCP protocol tests
  test/claude-agent.test.js  Claude agent loop vs. a local mock API
  test/openai-agent.test.js  OpenAI-compatible agent loop vs. a local mock API
docs/SUBMISSION.md      Devpost text, demo script, feedback drafts
```

## Built with

React 19, Vite 7, Node.js, Express 5, zod 4, the Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`), the Anthropic TypeScript/JavaScript SDK (`@anthropic-ai/sdk`) with Claude tool use, the OpenAI-compatible Chat Completions format (Groq, Gemini, OpenRouter, Ollama), and the Web Speech API.

## License

MIT. See [LICENSE](LICENSE).
