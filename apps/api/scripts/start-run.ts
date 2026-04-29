#!/usr/bin/env tsx
// Start a run by picking a manager and one or more worker presets from
// packages/shared. Polls until the run reaches a terminal status, printing
// each round as it completes. Assumes the API is running on localhost:4000
// (override with API_URL).
//
// Usage:
//   pnpm start-run                                            # interactive picker
//   pnpm start-run michael-scott jim-halpert pam-beesly       # by preset keys
//   pnpm start-run michael-scott jim-halpert --rounds 5 --target 200
//   pnpm start-run --help                                     # show preset list

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { PRESETS_BY_ROLE, getPreset } from '@work-sim/shared';
import type {
  AvatarPreset,
  DashboardPerAvatar,
  DashboardRound,
  RunDetail,
} from '@work-sim/shared';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

interface Args {
  managerKey?: string;
  workerKeys: string[];
  rounds: number;
  target: number;
  model: string;
  temperature: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    workerKeys: [],
    rounds: 10,
    target: 500,
    model: 'gpt-4o-mini',
    temperature: 0.8,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a === '--rounds') {
      args.rounds = Number(argv[++i]);
    } else if (a === '--target') {
      args.target = Number(argv[++i]);
    } else if (a === '--model') {
      args.model = String(argv[++i]);
    } else if (a === '--temperature') {
      args.temperature = Number(argv[++i]);
    } else if (a.startsWith('-')) {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    } else {
      positional.push(a);
    }
  }
  args.managerKey = positional[0];
  args.workerKeys = positional.slice(1);
  return args;
}

function printHelp(): void {
  console.log(`Usage: pnpm start-run [manager-key] [worker-key]+ [flags]

Flags:
  --rounds N          number of rounds (default 10)
  --target N          target paper count (default 500)
  --model NAME        model id (default gpt-4o-mini)
  --temperature N     sampling temperature (default 0.8)
  --help, -h          show this help

Manager presets:`);
  for (const p of PRESETS_BY_ROLE.manager) {
    console.log(`  ${p.key.padEnd(18)} ${p.display_name}`);
  }
  console.log('\nWorker presets:');
  for (const p of PRESETS_BY_ROLE.worker) {
    console.log(`  ${p.key.padEnd(18)} ${p.display_name} (baseline=${p.baseline_output})`);
  }
}

async function pickPresetInteractive(role: 'manager' | 'worker'): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const presets = PRESETS_BY_ROLE[role];
  console.log(`\nPick a ${role}:`);
  presets.forEach((p, i) => console.log(`  ${i + 1}. ${p.display_name} (${p.key})`));
  const ans = (await rl.question(`Enter 1-${presets.length}: `)).trim();
  rl.close();
  const idx = Number(ans) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= presets.length) {
    throw new Error(`invalid selection: ${ans}`);
  }
  return presets[idx]!.key;
}

async function pickWorkersInteractive(): Promise<string[]> {
  const rl = createInterface({ input: stdin, output: stdout });
  const presets = PRESETS_BY_ROLE.worker;
  console.log('\nPick workers (comma-separated indexes, e.g. "1,3,4"):');
  presets.forEach((p, i) =>
    console.log(`  ${i + 1}. ${p.display_name} (${p.key}, baseline=${p.baseline_output})`),
  );
  const ans = (await rl.question(`Enter 1-${presets.length}: `)).trim();
  rl.close();
  const indexes = ans.split(',').map((s) => Number(s.trim()) - 1);
  for (const idx of indexes) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= presets.length) {
      throw new Error(`invalid selection: ${ans}`);
    }
  }
  return indexes.map((i) => presets[i]!.key);
}

function presetToRequest(preset: AvatarPreset): {
  role_in_sim: AvatarPreset['role_in_sim'];
  name: string;
  role_label: string;
  personality: string;
  values: string;
  baseline_output: number;
} {
  return {
    role_in_sim: preset.role_in_sim,
    name: preset.name,
    role_label: preset.role_label,
    personality: preset.personality,
    values: preset.values,
    baseline_output: preset.baseline_output,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const managerKey = args.managerKey ?? (await pickPresetInteractive('manager'));
  const workerKeys =
    args.workerKeys.length > 0 ? args.workerKeys : await pickWorkersInteractive();

  const manager = getPreset(managerKey);
  if (!manager || manager.role_in_sim !== 'manager') {
    throw new Error(`unknown or non-manager preset: ${managerKey}`);
  }
  const workers = workerKeys.map((k) => {
    const w = getPreset(k);
    if (!w || w.role_in_sim !== 'worker') {
      throw new Error(`unknown or non-worker preset: ${k}`);
    }
    return w;
  });
  if (workers.length === 0) {
    throw new Error('at least one worker is required');
  }

  const body = {
    avatars: [presetToRequest(manager), ...workers.map(presetToRequest)],
    target_paper: args.target,
    rounds_total: args.rounds,
    model: args.model,
    temperature: args.temperature,
  };

  console.log(`\n→ POST ${API_URL}/runs`);
  console.log(`  manager: ${manager.display_name}`);
  for (const w of workers) {
    console.log(`  worker:  ${w.display_name} (baseline=${w.baseline_output})`);
  }
  console.log(`  target=${args.target}  rounds=${args.rounds}  model=${args.model}  temp=${args.temperature}\n`);

  const res = await fetch(`${API_URL}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST /runs failed: ${res.status} ${text}`);
  }
  const { id } = (await res.json()) as { id: string };
  console.log(`Run id: ${id}\n`);

  let lastSeenRound = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const detail = (await fetch(`${API_URL}/runs/${id}`).then((r) => r.json())) as RunDetail;

    const nameById = new Map(detail.per_avatar.map((p) => [p.avatar_id, p.name]));

    const newRounds = detail.rounds.filter((r) => r.round_index > lastSeenRound);
    for (const r of newRounds) {
      printRound(r, detail.per_avatar, nameById);
      lastSeenRound = r.round_index;
    }

    if (['completed', 'failed', 'cancelled'].includes(detail.status)) {
      console.log(
        `\n=== ${detail.status.toUpperCase()} === paper=${detail.paper_total}/${detail.target_paper}` +
          (detail.error_message ? `  err=${detail.error_message}` : ''),
      );
      return;
    }
  }
}

function printRound(
  round: DashboardRound,
  perAvatar: DashboardPerAvatar[],
  nameById: ReadonlyMap<string, string>,
): void {
  console.log(`── Round ${round.round_index} [${round.situation_tag}] ──`);
  for (const a of round.avatars) {
    const name = nameById.get(a.avatar_id) ?? a.avatar_id;
    if (a.morale === null && a.paper_sold === null) {
      console.log(`  ${name.padEnd(20)} (manager)`);
    } else {
      console.log(`  ${name.padEnd(20)} morale=${a.morale}  paper=${a.paper_sold}`);
    }
  }
  void perAvatar;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
