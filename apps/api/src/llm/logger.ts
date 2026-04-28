// Optional LLM call logging for debugging prompts and responses.
// Controlled by LOG_LLM=1 env var. Logs JSON to stderr so it doesn't interfere
// with stdout/HTTP responses.

import { z } from 'zod';

import type { LLMClient, LLMCallOptions, Message } from '@work-sim/shared';

const enabled = process.env.LOG_LLM === '1';

export function maybeWrapWithLogging(client: LLMClient): LLMClient {
  if (!enabled) return client;

  return {
    async complete(messages: Message[], opts: LLMCallOptions): Promise<string> {
      logRequest('complete', messages, opts);
      const result = await client.complete(messages, opts);
      logResponse('complete', result);
      return result;
    },

    async completeStructured<T>(
      messages: Message[],
      schema: z.ZodSchema<T>,
      schemaName: string,
      opts: LLMCallOptions,
    ): Promise<T> {
      logRequest('completeStructured', messages, opts, schemaName);
      const result = await client.completeStructured(messages, schema, schemaName, opts);
      logResponse('completeStructured', result);
      return result;
    },
  };
}

function logRequest(
  kind: string,
  messages: Message[],
  opts: LLMCallOptions,
  schemaName?: string,
): void {
  console.error(
    JSON.stringify(
      {
        _log: 'llm-request',
        kind,
        model: opts.model,
        temperature: opts.temperature,
        topP: opts.topP,
        maxTokens: opts.maxTokens,
        schemaName,
        messageCount: messages.length,
        messages,
      },
      null,
      2,
    ),
  );
}

function logResponse(kind: string, result: unknown): void {
  console.error(
    JSON.stringify(
      {
        _log: 'llm-response',
        kind,
        result,
      },
      null,
      2,
    ),
  );
}
