// Provider-agnostic LLM interface. The simulation engine only ever talks to
// this surface — concrete providers (OpenAIClient, future AnthropicClient)
// implement it. Switching providers is a one-line change in
// apps/api/src/llm/index.ts (the factory).
//
// Three structured-output schemas live here, one per call site:
//   - OpeningTurnSchema           — peer initiator's first call (message only)
//   - ReactionTurnSchema          — worker side of manager 1:1, peer responder
//   - InitiatorReflectionSchema   — peer initiator's second call (after reply)
//
// The split exists because morale updates only on REACTION to a stimulus —
// initiating a conversation doesn't itself shift your morale, but receiving a
// response does. So peer initiation is a 2-call dance: emit a message, then
// after seeing the responder's reply, emit the morale delta + perception update.

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
 * - `completeStructured` returns a Zod-validated object — used for every
 *   structured emission (OpeningTurn / ReactionTurn / InitiatorReflection).
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
 * Lower/upper bound on each emitted morale delta. The avatar judges this
 * exchange in isolation; the engine accumulates and clamps the running total
 * to 0..100. See apps/api/src/engine/scoring.ts.
 */
export const MORALE_DELTA_MIN = -10;
export const MORALE_DELTA_MAX = 10;

/**
 * Peer initiator's first call: just emit what you say. The avatar can't yet
 * judge how the exchange landed because there's no reply, so morale and
 * self-perception updates are deferred to the second call.
 */
export const OpeningTurnSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type OpeningTurn = z.infer<typeof OpeningTurnSchema>;

/**
 * Used by the worker side of a manager 1:1 and by the peer responder. The
 * speaker has full context (they've heard what was said to them) so they
 * emit a reply AND their internal-state updates in one turn.
 */
export const ReactionTurnSchema = z.object({
  /** What the avatar says. 1–3 short sentences (rule lives in the prompt). */
  message: z.string().min(1).max(2000),

  /**
   * The avatar's updated private self-perception. Singleton per avatar,
   * mutated every reaction. Manager prompts NEVER see any worker's
   * self_perception (information asymmetry, design.md §7); peer prompts only
   * see the avatar's own.
   */
  updated_self_perception: z.string().min(1).max(1000),

  /**
   * Integer in [-10, +10]. How this exchange shifted the avatar's engagement
   * and motivation. 0 means no change. Engine sums deltas across the run and
   * clamps to 0..100; manager-1:1 deltas are weighted before summing.
   */
  morale_delta: z.number().int().min(MORALE_DELTA_MIN).max(MORALE_DELTA_MAX),

  /**
   * One short sentence explaining the delta — what about this exchange
   * shifted (or didn't shift) the avatar's engagement. Forces the model to
   * reason about the change rather than emitting a hash. Kept private to the
   * avatar — never appears in another avatar's prompt.
   */
  morale_rationale: z.string().min(1).max(500),
});
export type ReactionTurn = z.infer<typeof ReactionTurnSchema>;

/**
 * Peer initiator's second call. The initiator emitted a message in call 1;
 * now they've seen the responder's reply and are reflecting on the exchange.
 * No new message — just internal-state updates.
 */
export const InitiatorReflectionSchema = z.object({
  updated_self_perception: z.string().min(1).max(1000),
  morale_delta: z.number().int().min(MORALE_DELTA_MIN).max(MORALE_DELTA_MAX),
  morale_rationale: z.string().min(1).max(500),
});
export type InitiatorReflection = z.infer<typeof InitiatorReflectionSchema>;
