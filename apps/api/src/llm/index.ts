// LLM client factory. The simulation engine receives an LLMClient at
// construction time; this is the single place that picks which concrete
// implementation to instantiate. Switching providers is a one-line change
// (uncomment the `anthropic` case once AnthropicClient lands).

import type { LLMClient } from '@work-sim/shared';
import { OpenAIClient } from './openai-client.js';

/**
 * Build the singleton LLMClient. Called once from index.ts at boot; the
 * Runner reuses the same instance for every run.
 *
 * The model name is *not* selected here — it comes per-call from
 * `runs.config_json.model`, so different runs can use different models
 * without restarting the server.
 */
export function createLLMClient(): LLMClient {
  const provider = process.env.LLM_PROVIDER ?? 'openai';

  switch (provider) {
    case 'openai': {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
      return new OpenAIClient(key);
    }

    // case 'anthropic': {
    //   const key = process.env.ANTHROPIC_API_KEY;
    //   if (!key) throw new Error('ANTHROPIC_API_KEY required when LLM_PROVIDER=anthropic');
    //   return new AnthropicClient(key);
    // }

    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  }
}
