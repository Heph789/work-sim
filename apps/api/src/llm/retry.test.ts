import { describe, expect, it, vi } from 'vitest';

import { MalformedStructuredOutputError } from './errors.js';
import { isTransient, withRetry } from './retry.js';

describe('isTransient', () => {
  it('treats malformed structured output as transient', () => {
    expect(isTransient(new MalformedStructuredOutputError('x'))).toBe(true);
  });

  it('treats 429 as transient', () => {
    expect(isTransient({ status: 429 })).toBe(true);
  });

  it('treats 5xx as transient', () => {
    expect(isTransient({ status: 503 })).toBe(true);
  });

  it('treats 4xx (non-429) as permanent', () => {
    expect(isTransient({ status: 400 })).toBe(false);
    expect(isTransient({ status: 401 })).toBe(false);
  });

  it('treats network error codes as transient', () => {
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true);
  });

  it('treats unknown errors as permanent', () => {
    expect(isTransient(new Error('boom'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows immediately on permanent errors', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 401 });
    await expect(withRetry(fn)).rejects.toEqual({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after MAX_ATTEMPTS', async () => {
    const fn = vi.fn().mockRejectedValue({ status: 503 });
    await expect(withRetry(fn)).rejects.toEqual({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10000);
});
