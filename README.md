# Jarvis LifeOS

A voice-first AI study and productivity assistant, built for the Amazon Developer "Build, Ship, Shape" hackathon (Alexa+ track). It has two surfaces over one set of tools:

1. **A self-hosted MCP server** at `/mcp` (MCP spec **2025-11-25**, **Streamable HTTP**). Any MCP client can manage the user's tasks and study plans through it. MCP is the open standard behind Alexa+ integrations.
2. **A simulated Alexa+-style web experience.** Talk or type to Jarvis. It picks a backend tool, the server validates the arguments and runs the operation against persistent storage, and the dashboard shows the real result: which tool ran, with which arguments, and whether it succeeded, failed or needs your confirmation.

> We have not connected this to Alexa+ itself (that requires Amazon's Alexa+ preview onboarding) and it does not run on Alexa devices. The MCP server is real and spec-compliant, and we tested it with the official MCP SDK client. The voice web app is a simulation.

## Features

- **Conversation with voice and text.** Browser speech recognition for input (where supported), speech synthesis for replies, and a text box that always works.
- **Real tool calling.** `createTask`, `listTasks`, `updateTask`, `completeTask`, `deleteTask`, `generateStudyPlan`, `updateStudyPlan` and `getDailySummary`. Each one validates its arguments with zod and changes persisted data. No result is hard-coded.
- **Task management.** Create, list (pending/completed/all), edit title, due date and priority, complete, and delete, from chat or from the Tasks page.
- **Study planner.** "Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming" becomes a timed schedule: focus blocks of at most 60 minutes with breaks between them. The plan is saved, and you can change it ("add 30 minutes of recursion to tomorrow's plan", "remove dynamic programming", "start the plan at 2pm").
- **Tool transparency.** Each assistant reply lists the tool calls it made, with status, the real result, any error, and expandable arguments. The Activity page shows the full log.
- **Confirmation for destructive actions.** Deleting a task, or replacing an existing study plan, waits for an explicit Confirm or Cancel.
- **Two AI engines:**
  - **Claude** (Anthropic API, tool use) when `ANTHROPIC_API_KEY` is set.
  - **Offline intent engine** when no key is set. It is a deterministic rule-based parser that calls the same tools. It understands fewer phrasings, and the UI labels its replies "offline engine". If a Claude call fails, Jarvis falls back to it and shows the API error.

## MCP server

- **Endpoint:** `POST/GET/DELETE http://localhost:8787/mcp`, Streamable HTTP with sessions (`Mcp-Session-Id`)
- **Protocol:** negotiates `2025-11-25`, the latest version, and falls back to older versions for older clients. Built with `@modelcontextprotocol/sdk` 1.32.
- **Tools:** the same eight tools, with JSON Schemas, titles and annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`). Results include readable `content` and `structuredContent` (`actionId`, `status`, `result`).
- **Human confirmation:** `deleteTask`, and `generateStudyPlan` when it would replace a plan, use **MCP elicitation** to ask the user if the client supports it. Otherwise the action stays pending until someone confirms it in the dashboard.
- **Shared state:** MCP calls write to the same store and appear in the dashboard's Activity log, tagged "MCP client".
- **Security:**
  - Host-header and Origin validation protect against DNS rebinding.
  - Set `MCP_AUTH_TOKEN` to require `Authorization: Bearer <token>`. Do this before exposing the server beyond localhost, and add your tunnel hostname to `MCP_ALLOWED_HOSTS`.

**Connect a client.** Run `npm run dev`, then point any Streamable HTTP MCP client at `http://localhost:8787/mcp`. For example, the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

Choose transport "Streamable HTTP" and URL `http://localhost:8787/mcp`.

## Quick start

Requirements: Node.js 20.6 or newer (tested on 25.9) and npm.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The API runs on http://localhost:8787 and Vite proxies `/api` to it.

To use Claude, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`, then restart `npm run dev`. The header shows which engine is active.

Other commands:

```bash
npm test
```

```bash
npm run build && npm start
```

`npm test` runs the backend end-to-end tests. `npm run build && npm start` serves the built client and the API together on port 8787.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables Claude tool calling. Server-side only, never sent to the browser. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Claude model id |
| `AI_PROVIDER` | auto | Set to `local` to force the offline engine even when a key is set |
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

All 23 tests pass.

We also ran the four scenarios by hand in the browser, plus confirm/cancel, inline task editing, page reload persistence, and desktop and mobile layouts.

**Not yet verified:** Claude tool selection against a live API key (the build machine had none). With an invalid key we confirmed that the SDK call reaches the Anthropic API, the 401 is handled, and the offline engine takes over with a visible notice.

## Limitations

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
  src/agent/            claude.js, local.js, index.js
  src/mcp.js            MCP server (Streamable HTTP, 2025-11-25)
  test/api.test.js      end-to-end REST + agent tests
  test/mcp.test.js      MCP protocol tests
docs/SUBMISSION.md      Devpost text, demo script, feedback drafts
```

## Built with

React 19, Vite 7, Node.js, Express 5, zod 4, the Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`), the Anthropic TypeScript/JavaScript SDK (`@anthropic-ai/sdk`) with Claude tool use, and the Web Speech API.

## License

MIT. See [LICENSE](LICENSE).
