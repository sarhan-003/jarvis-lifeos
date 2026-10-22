# Submission kit: Jarvis LifeOS

Verified on 2026-10-22 from https://amazonappdev2026.devpost.com/ and its rules page. Re-check before submitting.

- **Deadline:** Oct 23, 2026 at 7:00 pm UTC
- **Eligibility:** you must be at or above the age of majority where you live. Teams must appoint one Representative who submits. Residents of Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea and other comprehensively sanctioned regions are excluded.
- **Track:** Alexa+. The main deliverable is a **self-hosted MCP server (spec 2025-11-25, Streamable HTTP)**. The repo imports and calls `@modelcontextprotocol/sdk` at runtime (`server/src/mcp.js`, mounted in `server/src/app.js`), which satisfies the runtime-technology requirement. The voice web app is the simulated Alexa+ experience on top. The video must show the MCP server in action.
- **Required:** a text description, a GitHub repo (public with an OSS license, or private and shared with testing@devpost.com and the Amazon reviewers listed on the page), a public English YouTube or Vimeo video under 3 minutes, product feedback on every tool, API and SDK used, and your track and mini-challenge selection.
- **Optional:** feature requests and friction logs. Friction logs can earn up to a 10% judging bonus.
- **AWS Builder mini challenge:** we are **not** entering. No AWS service is integrated.

## Project description (draft)

**Jarvis LifeOS** is a voice-first study and productivity assistant that simulates an Alexa+-style agentic experience in the browser. Students speak or type naturally ("Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming"). Jarvis chooses a backend tool, the server validates the arguments and performs a real operation on persistent data, and the reply is spoken back.

What makes it agentic rather than a chatbot:
- Eight backend tools (create, list, update, complete and delete tasks; generate and update study plans; daily summary) with schema validation. Every result comes from the database.
- Full transparency: each reply shows which tool ran, its arguments, its status and its actual result or error.
- Safety: destructive actions (deleting a task, replacing a plan) wait for explicit confirmation. Ambiguous requests return candidates instead of guessing.
- The study planner turns topics and durations into a timed schedule of focus blocks and breaks. You can then change it by voice.

The same tools are exposed through a self-hosted **MCP server** (spec 2025-11-25, Streamable HTTP), so any MCP-capable agent can drive the same data. MCP clients that support elicitation get a confirmation prompt before anything destructive happens.

How it works: React + Vite front end using the Web Speech API for voice in and out. Node + Express back end with one tool catalogue (zod schemas) shared by Claude tool use (Anthropic API) and a deterministic offline intent engine, so the app keeps working without an API key. Data is stored in a JSON file with atomic writes.

## Demo video script (target 2:30)

1. **0:00–0:15** Problem: students juggle tasks and study time. Jarvis is an Alexa+-style assistant that *does* things, not just talks. Show the dashboard.
2. **0:15–0:45** Voice: click the orb and say "Create a task to revise binary trees tomorrow." Show the `createTask` card marked Done and the task in Pending tasks.
3. **0:45–1:05** Say "Show my pending tasks." The `listTasks` card shows the real records.
4. **1:05–1:40** Say "Create a study plan for tomorrow with two hours of graph algorithms and one hour of dynamic programming." The timeline appears. Then say "Add 30 minutes of recursion to tomorrow's plan" and show the schedule update.
5. **1:40–2:00** Say "Mark binary trees complete." The task moves to completed.
6. **2:00–2:15** Say "Delete …". Show the Needs confirmation card, click Confirm, then open the Activity log.
7. **2:15–2:40** MCP: in MCP Inspector (Streamable HTTP, `http://localhost:8787/mcp`), show protocol 2025-11-25, run `tools/list`, call `createTask`, then switch to the dashboard where the task appears and the Activity log shows "MCP client".
8. **2:40–2:50** Reload the page to show the data persists. Close with the architecture slide.

Record with the Claude engine enabled if you have a key. The header says which engine is active, so state it honestly on screen.

## Product feedback (draft: edit with your own experience)

- **Anthropic Claude API / `@anthropic-ai/sdk`:** used for tool calling. Tool definitions are generated from zod schemas. *Fill in: what worked, onboarding, what needs work.*
- **Web Speech API (SpeechRecognition / speechSynthesis):** voice input and output. Works in Chrome and Edge, not in Firefox. Recognition errors need custom handling.
- **MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.32, spec 2025-11-25):** used for the self-hosted Streamable HTTP server.
  - We used the low-level `Server` so tools/list could serve our existing JSON Schemas and every call would go through our own validator and audit log.
  - Elicitation needs stateful sessions. In stateless mode the per-request server never sees the client's capabilities, and nothing warns you, which cost us debugging time. This is a good friction-log entry.
  - The built-in `hostHeaderValidation` middleware was easy to use.
  - *Fill in: onboarding and what you'd change.*

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
