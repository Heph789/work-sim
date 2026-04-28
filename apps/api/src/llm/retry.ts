// Exponential-backoff retry wrapper used by every concrete LLMClient method.
// Centralizing here means each provider implementation just calls
// `withRetry(() => provider.api(...))` and gets the same retry policy for free.
//
// Policy (per docs/initial-prototype/llm-client.md):
//   - Up to 3 attempts total.
//   - Base delay 500ms, doubled each attempt, +0–250ms jitter.
//   - Retry on 429, 5xx, network timeouts, malformed structured output.
//   - Fail fast on 401/403 (auth), 400 (bad request), content-policy refusals.

import { MalformedStructuredOutputError } from './errors.js';

/** Total attempts including the first one. */
const MAX_ATTEMPTS = 3;

/** Base delay before the second attempt; doubled per subsequent attempt. */
const BASE_DELAY_MS = 500;

/**
 * Run `fn`, retrying transient failures with exponential backoff + jitter.
 * If all attempts fail, the last error is rethrown so the runner can persist
 * it as `runs.error_message`.
 */
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

/**
 * Classifier for transient vs. permanent errors. Exported so tests can pin
 * its behavior; the retry loop is the only runtime caller.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof MalformedStructuredOutputError) return true;
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  const code = (err as { code?: string })?.code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED') return true;
  return false;
}
