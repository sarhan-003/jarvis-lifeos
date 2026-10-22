# Submission kit: Jarvis LifeOS

Verified on 2026-10-22 from https://amazonappdev2026.devpost.com/ and its rules page. Re-check before submitting.

- **Deadline:** Oct 23, 2026 at 7:00 pm UTC
- **Eligibility:** you must be at or above the age of majority where you live. Teams must appoint one Representative who submits. Residents of Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea and other comprehensively sanctioned regions are excluded.
- **Track:** Alexa+. The main deliverable is a **self-hosted MCP server (spec 2025-11-25, Streamable HTTP)**. The repo imports and calls `@modelcontextprotocol/sdk` at runtime (`server/src/mcp.js`, mounted in `server/src/app.js`), which satisfies the runtime-technology requirement. The voice web app is the simulated Alexa+ experience on top. The video must show the MCP server in action.
- **Required:** a text description, a GitHub repo (public with an OSS license, or private and shared with testing@devpost.com and the Amazon reviewers listed on the page), a public English YouTube or Vimeo video under 3 minutes, product feedback on every tool, API and SDK used, and your track and mini-challenge selection.
- **Optional:** feature requests and friction logs. Friction logs can earn up to a 10% judging bonus.
- **AWS Builder mini challenge:** we are **not** entering. No AWS service is integrated.

## Project description (draft)

**Jarvis LifeOS is a study and productivity integration for Alexa+, built the way Alexa+ brand experiences are built: as a self-hosted MCP server.** A student can say "Alexa, ask Jarvis to create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming." The agent finds Jarvis's tools over MCP, calls them, and speaks back a real, saved, timed schedule.

What we built:
- **A self-hosted MCP server** (spec 2025-11-25, Streamable HTTP, sessions) with 8 tools:
  - tools: create, list, update, complete and delete tasks; generate and update study plans; daily summary
  - schema validation and MCP tool annotations (read-only, destructive, idempotent)
  - human confirmation through MCP elicitation for destructive actions
  - Host/Origin protection and optional bearer auth
- **An Alexa+ simulator web app**, the track's simulated-experience path.
  - Its agent is an MCP client of the Jarvis server, exactly like Alexa+ with a brand integration: `tools/list` to discover, `tools/call` to act.
  - It supports voice in (Web Speech API), spoken replies, a light ring, and "Alexa, ask Jarvis to…" invocations.
  - Every reply shows its MCP trace and the real result from the database.
- **Free, swappable AI:** Gemini or Groq free tiers, OpenRouter free models, or Ollama locally, through one OpenAI-compatible adapter. It also supports Claude, and a built-in offline engine so the demo works with no key at all.
- **Safety and transparency:** destructive actions need explicit confirmation, ambiguous requests return candidates instead of guessing, and every tool call (from the simulator or any external MCP client) is in the activity log.

How it works: React + Vite front end. Node + Express back end with the MCP server built on `@modelcontextprotocol/sdk`, zod-validated tools, and a JSON file store with atomic writes. 39 automated tests cover the REST API, the agent loops and the MCP protocol.

## Demo video script (target 2:30)

1. **0:00–0:15** Problem: students juggle tasks and study time. Jarvis LifeOS is the integration that lets Alexa+ actually *do* things for them. Show the README architecture diagram.
2. **0:15–0:35** MCP server page: endpoint, protocol 2025-11-25, Streamable HTTP, the 8 tools discovered live with their annotations.
3. **0:35–1:00** Alexa+ simulator: tap the ring and say "Alexa, ask Jarvis to create a task to revise binary trees tomorrow." Point at the trace (`→ MCP Streamable HTTP → tools/call createTask ✓`) and the task in Pending tasks.
4. **1:00–1:15** "Alexa, ask Jarvis to show my pending tasks." `tools/call listTasks` returns the real records.
5. **1:15–1:50** "Alexa, ask Jarvis to create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming." The timeline appears. Then "…add 30 minutes of recursion to tomorrow's plan" and show the schedule update.
6. **1:50–2:05** "Alexa, ask Jarvis to mark binary trees complete." The task moves to completed.
7. **2:05–2:20** "Alexa, ask Jarvis to delete binary trees." Show the Needs confirmation card, then click Confirm.
8. **2:20–2:45** External MCP client: in MCP Inspector (Streamable HTTP, `http://localhost:8787/mcp`), run `tools/list`, call `createTask`, then switch to the dashboard where it appears, tagged "MCP client".
9. **2:45–2:55** Reload to show persistence, and close.

Record with a free LLM engine (Gemini or Groq) if a key is set up. The simulator header names the active engine, so state it honestly. Don't show the real Alexa logo or claim it runs on Alexa devices: say "simulated Alexa+".

## Product feedback (draft: edit with your own experience)

- **Anthropic Claude API / `@anthropic-ai/sdk`:** used for tool calling. Tool definitions are generated from zod schemas. *Fill in: what worked, onboarding, what needs work.*
- **Web Speech API (SpeechRecognition / speechSynthesis):** voice input and output. Works in Chrome and Edge, not in Firefox. Recognition errors need custom handling.
- **MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32, spec 2025-11-25):** used for the self-hosted Streamable HTTP server.
  - We used the low-level `Server` so tools/list could serve our existing JSON Schemas and every call would go through our own validator and audit log.
  - Elicitation needs stateful sessions. In stateless mode the per-request server never sees the client's capabilities, and nothing warns you, which cost us debugging time. This is a good friction-log entry.
  - The built-in `hostHeaderValidation` middleware was easy to use.
  - *Fill in: onboarding and what you'd change.*

## Friction log (draft: real issues from this build, review before submitting)

Each entry below happened during development and is reproducible in this repo's history and tests. Severity uses the Devpost scale.

### 1. Elicitation silently skipped with the stateless Streamable HTTP transport
- **Task:** ask the user to confirm a destructive tool call (`deleteTask`) via MCP elicitation.
- **Steps:**
  1. Used `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined` (stateless) and a new `Server` per POST, as in the SDK's stateless example.
  2. Inside `tools/call`, checked `server.getClientCapabilities()?.elicitation`, then called `server.elicitInput(...)`.
- **Expected:** the client, which declared `elicitation: { form: {} }`, gets the prompt.
- **Actual:** `getClientCapabilities()` was `undefined`, because the per-request server never saw `initialize`. The client's elicitation reply would also arrive as a separate POST that no server instance is waiting for. Nothing warned us: the confirmation path was just skipped, and our test caught it.
- **Severity:** important.
- **Workaround:** switched to stateful sessions (session map, `onsessioninitialized`, idle cleanup). See `server/src/mcp.js`.
- **Suggestion:** document that elicitation (and sampling) need stateful mode, and have `elicitInput` throw a clear error when capabilities are unknown, instead of the feature silently not working.

### 2. `registerTool` forces SDK-side validation
- **Task:** expose an existing tool catalogue (zod schemas plus our own normalization, confirmation and audit pipeline) over MCP.
- **Steps:** tried `McpServer.registerTool` with our zod schemas.
- **Expected:** a way to hand raw arguments to our own validator, so relative dates like "tomorrow" get normalized and failed calls get logged.
- **Actual:** the SDK validates first, so invalid calls never reach our audit log and inputs can't be normalized.
- **Severity:** nice-to-have.
- **Workaround:** used the low-level `Server` with `ListToolsRequestSchema` / `CallToolRequestSchema` handlers and served our own JSON Schemas.
- **Suggestion:** a `registerTool` option to accept a plain JSON Schema and skip built-in validation.

## Team split (API contract first)

The API contract is the table in the README plus the action record shape. Freeze it before splitting work.

| Member | Owns | Files |
|---|---|---|
| 1. Technical lead | AI integration, tool calling, final integration | `server/src/agent/*`, `server/src/executor.js`, `server/src/tools.js` |
| 2. Frontend | Dashboard, chat, voice, responsive design | `client/src/**` |
| 3. Backend + QA | Task and plan APIs, storage, validation, tests, README, demo | `server/src/app.js`, `server/src/store.js`, `server/test/*`, `README.md`, `docs/*` |

Use one feature branch per change (`feat/…`, `fix/…`), run `npm test` and `npm run build` before merging, and keep `main` demo-ready.

## Pre-existing work

None. The project was built from scratch during the hackathon window, starting 2026-10-22.
