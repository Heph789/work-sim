// Cookie + query-string helpers for scenario selection. Lives in lib/mock so
// route handlers can share it without depending on Next App Router internals.
//
// Resolution order:
//   1. ?scenario=<name> on the request URL (and we Set-Cookie back so future
//      requests pick it up automatically).
//   2. mock-scenario cookie.
//   3. Fallback: 'default'.

import { SCENARIOS } from './scenarios/index.js';

export const COOKIE_NAME = 'mock-scenario';
export const DEFAULT_SCENARIO = 'default';

/**
 * Pull the scenario from a query string (preferred) or a cookie header.
 * Returns the scenario name plus a flag indicating whether the caller should
 * Set-Cookie on the response (true when ?scenario=… was used).
 */
export function resolveScenario(req: Request): {
  scenario: string;
  setCookie: boolean;
} {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('scenario');
  if (fromQuery && SCENARIOS[fromQuery]) {
    return { scenario: fromQuery, setCookie: true };
  }
  const cookieHeader = req.headers.get('cookie') ?? '';
  const fromCookie = parseCookie(cookieHeader, COOKIE_NAME);
  if (fromCookie && SCENARIOS[fromCookie]) {
    return { scenario: fromCookie, setCookie: false };
  }
  return { scenario: DEFAULT_SCENARIO, setCookie: false };
}

/** Build the Set-Cookie header value for persisting the active scenario. */
export function setCookieHeader(scenario: string): string {
  // 7-day expiry; Path=/ so every page sees it; SameSite=Lax for nav safety.
  const maxAge = 60 * 60 * 24 * 7;
  return `${COOKIE_NAME}=${encodeURIComponent(scenario)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
