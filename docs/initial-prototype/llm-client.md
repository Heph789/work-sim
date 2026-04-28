# LLM Client

Provider-agnostic interface for LLM calls. The simulation engine never imports
`openai` directly — it imports `LLMClient` from `@work-sim/shared` and calls
two methods. Switching providers is changing one factory line in
`apps/api/src/llm/index.ts`.

For why we abstract, see `locked-decisions.md` #9.

---

## Interface

```ts
// packages/shared/src/llm-client.ts
import { z } from 'zod';

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface LLMCallOptions {
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
}

export interface LLMClient {
  complete(messages: Message[], opts: LLMCallOptions): Promise<string>;

  completeStructured<T>(
    messages: Message[],
    schema: z.ZodSchema<T>,
    schemaName: string,
    opts: LLMCallOptions,
  ): Promise<T>;
}
```

That's the entire surface. Two methods. The engine uses `complete` for the
manager turn (free text) and `completeStructured` for the worker turn (typed
JSON: `{ message, updated_self_perception, morale }`).

Notes:

- `Message` is OpenAI-shaped because that's what most provider SDKs converge
  on. The Anthropic implementation maps internally.
- `schemaName` is needed because OpenAI's structured outputs API requires a
  named JSON schema. The Zod schema is *also* used to re-validate the parsed
  response (defense in depth).
- No streaming primitives in the interface. The prototype doesn't stream;
  adding `completeStream` later is additive.
- No prompt-caching primitives in the interface. Both providers handle it
  natively (OpenAI: automatic on ≥1024-token prefixes; Anthropic: explicit
  `cache_control` headers). The engine just structures prompts so the static
  prefix (profile + rubric) comes first and the dynamic suffix (transcript +
  this round's inputs) comes last.

---

## Implementations

### `OpenAIClient` (v1 default)

Lives at `apps/api/src/llm/openai-client.ts`.

```ts
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';

export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(messages, opts) {
    return withRetry(() => this.client.chat.completions.create({
      model: opts.model,
      messages,
      temperature: opts.temperature,
      top_p: opts.topP,
      max_tokens: opts.maxTokens,
    })).then((res) => res.choices[0].message.content ?? '');
  }

  async completeStructured(messages, schema, schemaName, opts) {
    const res = await withRetry(() => this.client.chat.completions.parse({
      model: opts.model,
      messages,
      temperature: opts.temperature,
      top_p: opts.topP,
      response_format: zodResponseFormat(schema, schemaName),
    }));
    const parsed = res.choices[0].message.parsed;
    if (!parsed) throw new MalformedStructuredOutputError('parsed missing');
    return schema.parse(parsed);  // defense-in-depth re-validation
  }
}
```

Key choices:

- Use OpenAI's `zodResponseFormat` helper to get strict structured outputs —
  this eliminates JSON-malformation errors by construction.
- Always re-validate with Zod after parsing in case the SDK helper relaxes
  in a future version.
- Retry wrapper is at the call boundary so both methods get it for free.

### `AnthropicClient` (planned, not built v1)

Same interface, uses tool-use for structured outputs:

```ts
// Sketch only — implement when needed.
async completeStructured(messages, schema, schemaName, opts) {
  const res = await this.client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    tools: [{
      name: schemaName,
      description: `Return a ${schemaName}.`,
      input_schema: zodToJsonSchema(schema),
    }],
    tool_choice: { type: 'tool', name: schemaName },
    messages: convertToAnthropicMessages(messages),
  });
  const tool = res.content.find((c) => c.type === 'tool_use');
  return schema.parse(tool.input);
}
```

---

## Retry policy

Lives in `apps/api/src/llm/retry.ts`. Used by both providers.

```ts
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_ATTEMPTS) throw err;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function isTransient(err: unknown): boolean {
  if (err instanceof MalformedStructuredOutputError) return true;
  // OpenAI SDK throws APIError with .status
  const status = (err as { status?: number })?.status;
  return status === 429 || (status !== undefined && status >= 500);
}
```

Transient (retry): 429 rate limits, 5xx server errors, network timeouts,
malformed structured output.

Non-transient (fail fast): 401/403 auth, 400 bad request, content policy
refusals.

---

## Error taxonomy

```ts
export class LLMError extends Error {}
export class MalformedStructuredOutputError extends LLMError {}
export class LLMRateLimitError extends LLMError {}
export class LLMAuthError extends LLMError {}
```

The runner only needs to know "did the call ultimately succeed or not." On
final failure, the runner sets `runs.status='failed'`, `error_message=err.message`,
`failed_at_round=current_round_index`, and stops. See `simulation-engine.md`.

---

## Factory

```ts
// apps/api/src/llm/index.ts
import { LLMClient } from '@work-sim/shared';
import { OpenAIClient } from './openai-client';

export function createLLMClient(): LLMClient {
  const provider = process.env.LLM_PROVIDER ?? 'openai';
  switch (provider) {
    case 'openai':
      return new OpenAIClient(process.env.OPENAI_API_KEY!);
    // case 'anthropic':
    //   return new AnthropicClient(process.env.ANTHROPIC_API_KEY!);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider}`);
  }
}
```

The runner constructs one client at boot and reuses it. The model name is *not*
hardcoded here — it comes from the run's `config_json.model` and is passed
per-call. That way different runs can use different models without restarting
the server.

---

## What the abstraction does NOT cover

- **Prompt construction.** Engine builds messages; client just sends them.
- **Token counting.** Useful for cost tracking; defer to a later observability
  pass.
- **Rate limit pre-flight.** Rely on the provider's 429s + retry; don't
  pre-emptively throttle.
- **Streaming.** No `completeStream` method until the UI needs it.
- **Embeddings.** No memory store in v1.
- **Multi-modal.** Text only.
