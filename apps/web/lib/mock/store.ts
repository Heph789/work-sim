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
  CreateRunRequest,
  RunDetail,
} from '@work-sim/shared';
import { STARTING_MORALE } from '@work-sim/shared';
import {
  buildPerAvatar,
  computeSignedDelta,
  computeTeamExpected,
  projectRounds,
} from './build-run.js';
import { SCENARIOS } from './scenarios/index.js';
import type { MockDrilldown, MockRun } from './types.js';

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

  const avatars = Object.values(run._drilldown.avatarProfiles);
  const workers = avatars.filter((a) => a.role_in_sim === 'worker');

  // Reconstruct per-worker prevMorale from the most recent drilldown round
  // entry for each worker.
  const prevMorale: Record<string, number> = {};
  for (const w of workers) {
    const entries = run._drilldown.roundEntries[w.id] ?? [];
    const last = [...entries].reverse().find((e) => e.morale !== null);
    prevMorale[w.id] = last?.morale ?? STARTING_MORALE;
  }

  const seed = hashStr(run.id);
  const projection = projectRounds({
    avatars,
    seed,
    fromRound: run.rounds_completed + 1,
    toRound: target,
    createdAtBase: run.tick_started_at,
    initialMorale: prevMorale,
  });

  // Append projected data into the run's existing arrays.
  run.rounds.push(...projection.rounds);
  run._drilldown.interactions.push(...projection.interactions);
  for (const [aid, entries] of Object.entries(projection.roundEntries)) {
    const dest = run._drilldown.roundEntries[aid];
    if (dest) dest.push(...entries);
  }
  run.rounds_completed = target;
  run.paper_total += projection.paperTotal;

  if (run.rounds_completed >= run.rounds_total) {
    run.status = 'completed';
  }

  // Re-derive aggregate fields whose value depends on rounds_completed.
  run.team_expected = computeTeamExpected({
    targetPaper: run.target_paper,
    roundsCompleted: run.rounds_completed,
    roundsTotal: run.rounds_total,
  });
  run.team_delta = computeSignedDelta(run.paper_total, run.team_expected);
  run.per_avatar = buildPerAvatar({
    avatars,
    projection: {
      rounds: run.rounds,
      interactions: run._drilldown.interactions,
      roundEntries: run._drilldown.roundEntries,
      endMorale: projection.endMorale,
      paperTotal: run.paper_total,
    },
    targetPaper: run.target_paper,
    roundsCompleted: run.rounds_completed,
    roundsTotal: run.rounds_total,
  });
}

/**
 * Build a brand-new MockRun from a CreateRunRequest body. Status starts
 * 'running' with an immediate tick anchor; the next GET will start producing
 * rounds.
 */
export function buildRunFromRequest(body: CreateRunRequest): MockRun {
  const id = shortId();
  // Generate run-scoped uuids; manager first then workers in submission order.
  const avatars: AvatarProfile[] = body.avatars.map((a, i) => ({
    id: `${id}-a${i + 1}`,
    role_in_sim: a.role_in_sim,
    name: a.name,
    role_label: a.role_label,
    personality: a.personality,
    values: a.values,
    baseline_output: a.baseline_output,
  }));
  avatars.sort((a, b) => {
    if (a.role_in_sim === b.role_in_sim) return 0;
    return a.role_in_sim === 'manager' ? -1 : 1;
  });

  const teamExpected = computeTeamExpected({
    targetPaper: body.target_paper,
    roundsCompleted: 0,
    roundsTotal: body.rounds_total,
  });

  const detail: RunDetail = {
    id,
    created_at: Date.now(),
    status: 'running',
    rounds_total: body.rounds_total,
    rounds_completed: 0,
    target_paper: body.target_paper,
    paper_total: 0,
    team_expected: teamExpected,
    team_delta: computeSignedDelta(0, teamExpected),
    experiment_id: null,
    config: {
      avatars: avatars.slice(),
      model: body.model ?? 'gpt-4.1',
      temperature: body.temperature ?? 0.8,
      top_p: 1.0,
      prompt_template_version: 'mock-1',
      sim_engine_version: 'mock-1',
    },
    rounds: [],
    per_avatar: buildPerAvatar({
      avatars,
      projection: {
        rounds: [],
        interactions: [],
        roundEntries: Object.fromEntries(avatars.map((a) => [a.id, []])),
        endMorale: Object.fromEntries(
          avatars.filter((a) => a.role_in_sim === 'worker').map((w) => [w.id, STARTING_MORALE]),
        ),
        paperTotal: 0,
      },
      targetPaper: body.target_paper,
      roundsCompleted: 0,
      roundsTotal: body.rounds_total,
    }),
    error_message: null,
    failed_at_round: null,
  };

  const drilldown: MockDrilldown = {
    interactions: [],
    roundEntries: Object.fromEntries(avatars.map((a) => [a.id, []])),
    avatarProfiles: Object.fromEntries(avatars.map((a) => [a.id, a])),
  };

  return { ...detail, tick_started_at: Date.now(), _drilldown: drilldown };
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
  return globalThis.crypto.randomUUID().split('-')[0]!;
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
