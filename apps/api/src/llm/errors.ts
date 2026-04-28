// Error taxonomy for the LLM layer. The runner only needs to know "did the
// call ultimately succeed or not" — but typed subclasses let `withRetry`
// classify transient vs. permanent failures without inspecting status codes
// at every call site.
//
// See docs/initial-prototype/llm-client.md (Error taxonomy section).

/** Base class for all LLM-layer errors. */
export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LLMError';
  }
}

/**
 * The provider returned a structured response that didn't parse (or that
 * Zod re-validation rejected). Treated as transient by `withRetry` because
 * it's almost always a one-off sampling artifact at temperature > 0.
 */
export class MalformedStructuredOutputError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedStructuredOutputError';
  }
}

/** Provider returned 429. Transient — retried with backoff. */
export class LLMRateLimitError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = 'LLMRateLimitError';
  }
}

/** Provider returned 401/403. Non-transient — fail the run immediately. */
export class LLMAuthError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = 'LLMAuthError';
  }
}
