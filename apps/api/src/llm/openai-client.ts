// Concrete LLMClient implementation backed by the official OpenAI SDK.
// Lives in apps/api (not packages/shared) because it has a runtime dep on
// `openai` — the shared package only exposes the interface.
//
// Structured outputs use `chat.completions.parse` + `zodResponseFormat`,
// which is OpenAI's strict-mode JSON schema mode — JSON malformation errors
// are eliminated by construction; we still re-validate with Zod as defense
// in depth.

// DEPENDENCY: openai
import OpenAI from 'openai';
// DEPENDENCY: openai (zod helper)
import { zodResponseFormat } from 'openai/helpers/zod';

import type { z } from 'zod';
import type {
  LLMClient,
  LLMCallOptions,
  Message,
} from '@work-sim/shared';

import { withRetry } from './retry.js';
import { MalformedStructuredOutputError } from './errors.js';

export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  /**
   * @param apiKey OPENAI_API_KEY. Required; no fallback to env inside this
   *               class — the factory reads env and passes it explicitly.
   */
  constructor(apiKey: string) {
    // TODO: this.client = new OpenAI({ apiKey });
    void apiKey;
    this.client = undefined as unknown as OpenAI;
  }

  /** Free-text completion. Used by the manager turn. */
  async complete(messages: Message[], opts: LLMCallOptions): Promise<string> {
    // TODO:
    //   const res = await withRetry(() => this.client.chat.completions.create({
    //     model: opts.model,
    //     messages,
    //     temperature: opts.temperature,
    //     top_p: opts.topP,
    //     max_tokens: opts.maxTokens,
    //   }));
    //   return res.choices[0]?.message?.content ?? '';
    void messages;
    void opts;
    void withRetry;
    throw new Error('OpenAIClient.complete: not implemented');
  }

  /**
   * Structured completion. Used by the worker turn.
   *
   * The schema is converted to OpenAI's response_format via `zodResponseFormat`;
   * OpenAI returns a strictly-typed object on `message.parsed`. We re-validate
   * with the same Zod schema in case the SDK helper relaxes in a future version.
   */
  async completeStructured<T>(
    messages: Message[],
    schema: z.ZodSchema<T>,
    schemaName: string,
    opts: LLMCallOptions,
  ): Promise<T> {
    // TODO:
    //   const res = await withRetry(() => this.client.chat.completions.parse({
    //     model: opts.model,
    //     messages,
    //     temperature: opts.temperature,
    //     top_p: opts.topP,
    //     response_format: zodResponseFormat(schema, schemaName),
    //   }));
    //   const parsed = res.choices[0]?.message?.parsed;
    //   if (parsed == null) throw new MalformedStructuredOutputError('parsed missing');
    //   return schema.parse(parsed);
    void messages;
    void schema;
    void schemaName;
    void opts;
    void zodResponseFormat;
    void MalformedStructuredOutputError;
    throw new Error('OpenAIClient.completeStructured: not implemented');
  }
}
