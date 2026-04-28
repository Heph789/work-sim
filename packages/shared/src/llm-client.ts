// Provider-agnostic LLM interface. The simulation engine only ever talks to
// this surface — concrete providers (OpenAIClient, future AnthropicClient)
// implement it. Switching providers is a one-line change in
// apps/api/src/llm/index.ts (the factory).
//
// See docs/initial-prototype/llm-client.md for full rationale.

// DEPENDENCY: zod — already in packages/shared/package.json.
import { z } from 'zod';

/**
 * Chat-shaped message tuple. Modeled on OpenAI's shape because most provider
 * SDKs converge on it; the (future) Anthropic implementation maps internally.
 */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

/**
 * Per-call generation parameters. Model name is *not* hardcoded in any
 * provider — it comes from `runs.config_json.model` so different runs can use
 * different models without restarting the server.
 */
export interface LLMCallOptions {
  model: string;
  /** Sampling temperature. Defaults to provider default if omitted. */
  temperature?: number;
  /** Nucleus sampling. Defaults to provider default if omitted. */
  topP?: number;
  /** Optional response token cap. */
  maxTokens?: number;
}

/**
 * The entire LLM surface used by the engine. Two methods.
 *
 * - `complete` returns free text — used for the manager turn.
 * - `completeStructured` returns a Zod-validated object — used for the worker
 *   turn (`{ message, updated_self_perception, morale }`). Implementations
 *   re-validate the parsed response with the supplied schema as defense in
 *   depth.
 *
 * Streaming, embeddings, and prompt-cache primitives are deliberately absent.
 * Adding `completeStream` later is additive.
 */
export interface LLMClient {
  /** Free-text completion. Throws on persistent failure (after retries). */
  complete(messages: Message[], opts: LLMCallOptions): Promise<string>;

  /**
   * Structured completion. The schema is the source of truth for the
   * response shape — providers convert it to their native structured-output
   * format (OpenAI: zodResponseFormat; Anthropic: tool-use input_schema).
   *
   * @param schemaName Required by OpenAI's strict-mode structured outputs.
   */
  completeStructured<T>(
    messages: Message[],
    schema: z.ZodSchema<T>,
    schemaName: string,
    opts: LLMCallOptions,
  ): Promise<T>;
}

/**
 * Worker-turn structured output schema. Lives next to the LLMClient interface
 * so the engine and the LLM layer agree on the wire shape.
 *
 * The morale int is the heart of the prototype — it drives paper_sold via a
 * deterministic formula in the engine (see scoring.ts).
 */
export const WorkerResponseSchema = z.object({
  /** What the worker says back to the manager. 1–3 short sentences. */
  message: z.string().min(1).max(2000),

  /**
   * Worker's updated private self-perception. Next round's worker prompt
   * reads this; manager prompts never see it. Preserves the asymmetry that
   * makes the sim interesting (per locked-decisions.md #7).
   */
  updated_self_perception: z.string().min(1).max(1000),

  /**
   * 1–2 sentences explaining WHY morale moved (or didn't) this round.
   * Forces the model to reason about morale as a delta from prior state
   * rather than re-anchoring on a default; private to the worker.
   */
  morale_rationale: z.string().min(1).max(500),

  /**
   * 0–100. 50 is neutral; <30 demoralized; >70 energized. The LLM emits this
   * subjective signal; the engine consumes it deterministically.
   */
  morale: z.number().int().min(0).max(100),
});

/** Inferred TS type — use this in engine code rather than re-declaring. */
export type WorkerResponse = z.infer<typeof WorkerResponseSchema>;
