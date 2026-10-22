# Build notes

## Versions used (installed)

- Node.js 25.9 (local), Docker images target Node 22 LTS. Scripts need Node ≥ 22.9 (`--env-file-if-exists`).
- TypeScript **5.9.3** (`strict`, `noUncheckedIndexedAccess`). TypeScript 7.0 is the current `latest` on npm, but the prompt asks for 5.x and typescript-eslint supports only up to 6.0.
- `@modelcontextprotocol/sdk` **1.32.1**. Its `LATEST_PROTOCOL_VERSION` is `2025-11-25`. Used: `McpServer.registerTool`, `StreamableHTTPServerTransport` (stateless), `Client` + `StreamableHTTPClientTransport`, `hostHeaderValidation`.
- Express 5.3, Zod 4.6, pino 10, Vitest 5.0.5.
- React 19 with **Vite 8.3.5** and `@vitejs/plugin-react` 6, plus Tailwind CSS 4.3 via `@tailwindcss/vite`.
- `@anthropic-ai/sdk` 0.110 and `@aws-sdk/client-bedrock-runtime` 3.1155.

## Deviations from the build prompt

1. **This repo previously held "Jarvis LifeOS".** That project is preserved at git tag `jarvis-lifeos-final`. Parcel Concierge was built in the same repo on branch `feat/parcel-concierge`.
2. **Vite 8 instead of 7.** Vitest 5 pulls in Vite 8. Having two copies of Vite broke the React plugin at dev time, so the web app uses Vite 8 and plugin-react 6.
3. **Delivery slots cover 7 days, not 5,** so "Saturday" always falls in the range. The next Saturday-evening slot is always available so demo phrase 5 works. Everything else uses a seeded PRNG (mulberry32), about 30% unavailable.
4. **Extra LLM providers:**
   - **offline**: a deterministic rule-based planner, so the demo works with no key
   - **OpenAI-compatible**: free tiers of Gemini, Groq, OpenRouter, or Ollama
   - **Anthropic** and **Bedrock** are implemented as specified
5. **Shared response types** (`Card`, `ChatResponse`) live in `packages/domain/src/api-types.ts`. The web app imports them type-only.
6. **The tool `structuredContent` envelope** is `{ ok, speech, ...data }`. Each tool's `outputSchema` declares `ok`/`speech`/`error`/`candidates` and allows the per-tool data fields.
7. **The "Pay duty" button** on the customs card sends "Pay the duty" rather than "Yes, pay the duty", so it always goes through the quote step first.
8. **Dev ports** are passed as `--port=` in the dev scripts, because some tools set `PORT` for the Vite server. Hosted deployments still use `PORT`.

## Verified

- `npm test`: 40/40 (domain 21, MCP 7, agent 12)
- `npm run typecheck` and `npm run lint`: clean
- `npm run build -w apps/web`: OK
- **All 8 demo utterances run by hand in the web UI** through agent-api, the MCP client, Streamable HTTP and the MCP server, using the offline engine. Bugs found and fixed:
  - "won't be home tomorrow … Saturday" rescheduled to tomorrow
  - verb agreement for plural nicknames
  - the tool-trace panel rendered on the wrong side
  - mixed Vite versions in dev

## Not verified / blocked (credentials or tools missing on the build machine)

- **Real LLM tool calling.** There's no Anthropic, AWS or Gemini/Groq key saved here. The Anthropic, Bedrock and OpenAI-compatible adapters type-check, but haven't been run against the live services. The tool loop is covered by a scripted fake LLM.
- **MCP Inspector.** Not run; it needs `npx` to download it. The protocol is covered by SDK-client tests.
- **Docker images and App Runner deployment.** Docker and the AWS CLI aren't installed. There's no public HTTPS URL yet.
- **Alexa+ add-on (`alexa-ai`).** The CLI isn't installed and there's no Alexa+ builder access.
- **Voice input with a real microphone.** The Web Speech API code is in place; typing was used for testing.

## P1/P2 status

| Item | Status |
|---|---|
| OAuth + PKCE, 401 without `WWW-Authenticate`, well-known metadata | Not started |
| Deploy the app (agent-api + web) | Dockerfile written, not built or deployed |
| Resource `shipment://{trackingNumber}` and prompt `daily_delivery_briefing` | Not started |
| Alexa+ add-on | Blocked (access) |
| Latency script, Playwright smoke test | Not started (the call log shows tool calls at about 5–12 ms) |
| MCP Apps timeline UI, wake word | Not started |

## Credentials and access still needed

- An LLM key: `ANTHROPIC_API_KEY`, AWS credentials with `BEDROCK_MODEL_ID`, or a free `LLM_API_KEY` for Gemini or Groq
- An AWS account with ECR and App Runner (or Render or Railway) for a public HTTPS URL
- Alexa+ builder access and the `alexa-ai` CLI
