// Pick the LLM provider from the environment. The offline engine is always
// available as the fallback.
import type { Env } from './env.js';
import type { ToolGateway } from './mcpClient.js';
import type { LlmProvider } from './llm/provider.js';
import { AnthropicProvider } from './llm/anthropic.js';
import { BedrockProvider } from './llm/bedrock.js';
import { OPENAI_PRESETS, OpenAICompatibleProvider } from './llm/openai.js';
import { OfflineProvider } from './llm/offline.js';

export interface ProviderChoice {
  provider: LlmProvider;
  offline: OfflineProvider;
  warning?: string;
}

export function createOffline(gateway: ToolGateway): OfflineProvider {
  let cache: { at: number; names: string[] } | null = null;
  return new OfflineProvider(async () => {
    if (cache && Date.now() - cache.at < 60_000) return cache.names;
    const r = await gateway.callTool('list_active_shipments', { include_delivered: true });
    const shipments = (r.structured?.shipments ?? []) as { nickname: string }[];
    cache = { at: Date.now(), names: shipments.map((s) => s.nickname) };
    return cache.names;
  });
}

export function chooseProvider(env: Env, gateway: ToolGateway): ProviderChoice {
  const offline = createOffline(gateway);
  const requested = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
  const fallback = (warning?: string): ProviderChoice => (warning ? { provider: offline, offline, warning } : { provider: offline, offline });

  if (requested === 'offline' || requested === 'local') return fallback();

  if (requested === 'bedrock') {
    if (!env.AWS_REGION || !env.BEDROCK_MODEL_ID) return fallback('LLM_PROVIDER=bedrock needs AWS_REGION and BEDROCK_MODEL_ID (plus AWS credentials). Using the offline engine.');
    return { provider: new BedrockProvider(env.AWS_REGION, env.BEDROCK_MODEL_ID), offline };
  }

  const preset = OPENAI_PRESETS[requested];
  if (preset) {
    const baseURL = env.LLM_BASE_URL ?? preset.baseURL;
    const model = env.LLM_MODEL ?? preset.model;
    const missing = [!baseURL && 'LLM_BASE_URL', !model && 'LLM_MODEL', preset.needsKey && !env.LLM_API_KEY && 'LLM_API_KEY'].filter(Boolean);
    if (missing.length || !baseURL || !model) return fallback(`LLM_PROVIDER=${requested} needs ${missing.join(', ')}. Using the offline engine.`);
    return { provider: new OpenAICompatibleProvider(requested, baseURL, model, env.LLM_API_KEY), offline };
  }

  if (requested === 'anthropic' || (!requested && env.ANTHROPIC_API_KEY)) {
    if (!env.ANTHROPIC_API_KEY) return fallback('LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY. Using the offline engine.');
    return { provider: new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL), offline };
  }

  if (requested) return fallback(`Unknown LLM_PROVIDER "${requested}". Using the offline engine.`);
  return fallback();
}
