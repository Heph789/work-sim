// Provider-agnostic LLM interface. The simulation engine only ever talks to
// this surface — concrete providers (OpenAIClient, future AnthropicClient)
// implement it. Switching providers is a one-line change in
// apps/api/src/llm/index.ts (the factory).
//
// This file is unchanged in shape from the prototype's `llm-client.ts` apart
// from the structured-output schema: `WorkerResponseSchema` is gone,
// `AvatarTurnSchema` replaces it. Every structured emission in the
// many-workers iteration uses the unified avatar-turn shape:
//   - worker side of a manager 1:1
//   - peer initiator
//   - peer responder

// DEPENDENCY: zod — already in packages/shared/package.json.
import { z } from 'zod';

/**
 * Chat-shaped message tuple. Modeled on OpenAI's shape because most provider
 * SDKs converge on it; the future Anthropic implementation maps internally.
 */
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

/**
 * Per-call generation parameters. Model name is *not* hardcoded in any
 * provider — it comes from `run.config_json.model` so different runs can use
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
 * - `complete` returns free text — used only for the manager's side of a 1:1.
 * - `completeStructured` returns a Zod-validated object — used for everything
 *   that emits an AvatarTurn (worker 1:1 reply, peer initiator, peer responder).
 *
 * Streaming, embeddings, and prompt-cache primitives are deliberately absent.
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
 * Unified avatar-turn structured output schema. Replaces the prototype's
 * `WorkerResponseSchema`. Every structured emission in the engine is shaped
 * by this schema regardless of context — the prompt's framing tells the
 * model who they're talking to, but the wire shape is identical.
 *
 * The `morale` int is the heart of the sim — it drives `paper_sold` via the
 * deterministic formula in apps/api/src/engine/scoring.ts.
 */
export const AvatarTurnSchema = z.object({
  /** What the avatar says. 1–3 short sentences (rule lives in the prompt). */
  message: z.string().min(1).max(2000),

  /**
   * The avatar's updated private self-perception. Singleton per avatar,
   * mutated every interaction. Manager prompts NEVER see any worker's
   * self_perception (information asymmetry, design.md §7); peer prompts only
   * see the avatar's own.
   */
  updated_self_perception: z.string().min(1).max(1000),

  /**
   * 0–100. 50 is neutral. Treat as continuous internal state — drift up or
   * down from the prior round's value rather than re-anchoring to a default.
   * The full range should be exercised across a long-enough run.
   */
  morale: z.number().int().min(0).max(100),

  /**
   * One short sentence explaining WHY this morale, given the day. Forces the
   * model to reason about the morale delta rather than emitting a hash. Kept
   * private to the avatar — never appears in another avatar's prompt.
   */
  morale_rationale: z.string().min(1).max(500),
});

/** Inferred TS type — use this in engine code rather than re-declaring. */
export type AvatarTurn = z.infer<typeof AvatarTurnSchema>;
