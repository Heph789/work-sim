// In-memory store backing the mock API. Module-level state persists across
// route-handler invocations within the same Next dev process — exactly what
// we want.
//
// Three responsibilities:
// 1. Lazily hydrate scenario seed data on first access.
// 2. Advance `running` runs based on wall-clock time so the dashboard has
//    visible motion (`tickIfRunning`).
// 3. Append POST-created runs to whichever scenario is currently selected.
//
// Mutation policy: `tickIfRunning` mutates the MockRun in place. The store
// is the only consumer, route handlers serialize its output to JSON before
// returning, and there's no concurrency story to defend against in dev.

import type {
  AvatarProfile,
  AvatarView,
  CreateRunRequest,
  RunDetail,
} from '@work-sim/shared';
import { fabricateRound, STARTING_MORALE } from './fabricate.js';
import { SCENARIOS } from './scenarios/index.js';
import type { MockRun } from './types.js';

/**
 * One round of fabricated state advances every TICK_MS milliseconds. 4s/round
 * is fast enough that the 2s dashboard poll shows visible movement, slow
 * enough that a 10-round run takes ~40s — long enough to inspect.
 */
const TICK_MS = 4000;

/** Lazy per-scenario cache. Built on first access via SCENARIOS[name](). */
const cache = new Map<string, MockRun[]>();

function ensureScenario(scenario: string): MockRun[] {
  let runs = cache.get(scenario);
  if (!runs) {
    const build = SCENARIOS[scenario] ?? SCENARIOS.default!;
    runs = build();
    cache.set(scenario, runs);
  }
  return runs;
}

/**
 * Returns the live (mutated as needed) array of runs for the named scenario.
 * Callers should NOT mutate the returned array.
 */
export function getRuns(scenario: string): MockRun[] {
  const runs = ensureScenario(scenario);
  for (const r of runs) tickIfRunning(r);
  return runs;
}

/** Look up a single run by id within the named scenario. Returns undefined for unknown ids. */
export function getRun(scenario: string, runId: string): MockRun | undefined {
  const runs = ensureScenario(scenario);
  const run = runs.find((r) => r.id === runId);
  if (run) tickIfRunning(run);
  return run;
}

/** Append a newly-POSTed run to the named scenario. */
export function addRun(scenario: string, run: MockRun): void {
  const runs = ensureScenario(scenario);
  runs.unshift(run); // newest first
}

/**
 * Advance a `running` run's state to where it should be at the current wall
 * clock. Computes targetCompleted from `(now - tick_started_at) / TICK_MS`,
 * fabricates any missing rounds, and flips status='completed' once the
 * target is reached.
 *
 * Idempotent and cheap when there's nothing to do.
 */
export function tickIfRunning(run: MockRun): void {
  if (run.status !== 'running') return;
  const elapsed = Date.now() - run.tick_started_at;
  const target = Math.min(run.rounds_total, Math.floor(elapsed / TICK_MS));
  if (target <= run.rounds_completed) return;

  // Reconstruct per-worker prevMorale from the most recent round_avatar row
  // for each worker. (Cheap: O(rounds * avatars).)
  const workers = run.avatars.filter((a) => a.role_in_sim === 'worker');
  const prevMorale: Record<string, number> = {};
  for (const w of workers) {
    const last = [...run.round_avatars]
      .filter((ra) => ra.avatar_id === w.id && ra.morale !== null)
      .sort((a, b) => a.round_index - b.round_index)
      .pop();
    prevMorale[w.id] = last?.morale ?? STARTING_MORALE;
  }

  // Use an arbitrary stable seed for tag picking: hash of run id.
  const seed = hashStr(run.id);

  let paperAdded = 0;
  for (let r = run.rounds_completed + 1; r <= target; r++) {
    const fr = fabricateRound({
      roundIndex: r,
      prevMorale,
      avatars: run.avatars,
      seed,
      createdAtBase: run.tick_started_at + r * TICK_MS,
      includePeer: workers.length >= 2,
    });
    run.rounds.push(fr.round);
    run.round_avatars.push(...fr.roundAvatars);
    run.interactions.push(...fr.interactions);
    paperAdded += fr.paperThisRound;
    for (const [k, v] of Object.entries(fr.endMorale)) prevMorale[k] = v;
  }
  run.rounds_completed = target;
  run.paper_total += paperAdded;

  if (run.rounds_completed >= run.rounds_total) {
    run.status = 'completed';
  }
}

/**
 * Build a brand-new MockRun from a CreateRunRequest body. Status starts
 * 'running' with an immediate tick anchor; the next GET will start producing
 * rounds.
 */
export function buildRunFromRequest(body: CreateRunRequest): MockRun {
  const id = shortId();
  const avatars: AvatarView[] = body.avatars.map((a: AvatarProfile, i) => ({
    id: `${id}-a${i + 1}`,
    role_in_sim: a.role_in_sim,
    name: a.name,
    role_label: a.role_label,
    personality: a.personality,
    values: a.values,
    baseline_output: a.baseline_output,
  }));
  // Stable order: manager first, then workers preserving submission order.
  avatars.sort((a, b) => {
    if (a.role_in_sim === b.role_in_sim) return 0;
    return a.role_in_sim === 'manager' ? -1 : 1;
  });

  const detail: RunDetail = {
    id,
    created_at: Date.now(),
    status: 'running',
    rounds_total: body.rounds_total,
    rounds_completed: 0,
    target_paper: body.target_paper,
    paper_total: 0,
    experiment_id: null,
    config: {
      avatars: avatars.map((a) => ({
        role_in_sim: a.role_in_sim,
        name: a.name,
        role_label: a.role_label,
        personality: a.personality,
        values: a.values,
        baseline_output: a.baseline_output,
      })),
      model: body.model ?? 'gpt-4.1',
      temperature: body.temperature ?? 0.8,
      top_p: 1.0,
      prompt_template_version: 'mock-1',
      sim_engine_version: 'mock-1',
    },
    avatars,
    rounds: [],
    round_avatars: [],
    interactions: [],
    error_message: null,
    failed_at_round: null,
  };
  return { ...detail, tick_started_at: Date.now() };
}

/**
 * Reset a scenario's cache. Useful in dev if a scenario builder changed and
 * you want to re-seed without restarting the dev server. Not wired to a
 * route in v1 — exported for future hot-reloading hooks.
 */
export function resetScenario(scenario: string): void {
  cache.delete(scenario);
}

function shortId(): string {
  // randomUUID exists in Node 19+; Next 15 ships on Node 18.17+. Available.
  return globalThis.crypto.randomUUID().split('-')[0]!;
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
