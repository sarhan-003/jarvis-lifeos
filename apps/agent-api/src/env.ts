// Environment, validated at startup. No secrets are hard-coded.
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().optional(),
  AGENT_PORT: z.coerce.number().int().positive().default(5200),
  MCP_SERVER_URL: z.url().default('http://localhost:5100/mcp'),
  MCP_DEV_TOKEN: z.string().optional(),
  /** anthropic | bedrock | gemini | groq | openrouter | ollama | openai-compatible | offline. Empty = auto. */
  LLM_PROVIDER: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  AWS_REGION: z.string().optional(),
  BEDROCK_MODEL_ID: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  WEB_DIST: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings in .env files as "not set".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  // Accept the older AI_PROVIDER name as an alias.
  if (!cleaned.LLM_PROVIDER && cleaned.AI_PROVIDER) cleaned.LLM_PROVIDER = cleaned.AI_PROVIDER;
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
