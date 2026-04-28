#!/usr/bin/env tsx
// Start a run by picking a manager and worker preset from packages/shared.
// Polls until the run reaches a terminal status, printing each round as it
// completes. Assumes the API is running on localhost:4000 (override with API_URL).
//
// Usage:
//   pnpm start-run                                      # interactive picker
//   pnpm start-run michael-scott jim-halpert            # by preset keys
//   pnpm start-run michael-scott jim-halpert --rounds 5 --target 200
//   pnpm start-run --help                               # show preset list

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { PRESETS_BY_ROLE, getPreset } from '@work-sim/shared';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

interface Args {
  managerKey?: string;
  workerKey?: string;
  rounds: number;
  target: number;
  model: string;
  temperature: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
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
  args.workerKey = positional[1];
  return args;
}

function printHelp(): void {
  console.log(`Usage: pnpm start-run [manager-key] [worker-key] [flags]

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const managerKey = args.managerKey ?? (await pickPresetInteractive('manager'));
  const workerKey = args.workerKey ?? (await pickPresetInteractive('worker'));

  const manager = getPreset(managerKey);
  const worker = getPreset(workerKey);
  if (!manager || manager.role_in_sim !== 'manager') {
    throw new Error(`unknown or non-manager preset: ${managerKey}`);
  }
  if (!worker || worker.role_in_sim !== 'worker') {
    throw new Error(`unknown or non-worker preset: ${workerKey}`);
  }

  // Strip preset-only fields (key, display_name) before posting.
  const { key: _mk, display_name: _md, ...managerProfile } = manager;
  const { key: _wk, display_name: _wd, ...workerProfile } = worker;
  void _mk; void _md; void _wk; void _wd;

  const body = {
    agents: [managerProfile, workerProfile],
    target_paper: args.target,
    rounds_total: args.rounds,
    model: args.model,
    temperature: args.temperature,
  };

  console.log(`\n→ POST ${API_URL}/runs`);
  console.log(`  manager: ${manager.display_name}`);
  console.log(`  worker:  ${worker.display_name} (baseline=${worker.baseline_output})`);
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
    const detail = await fetch(`${API_URL}/runs/${id}`).then((r) => r.json()) as {
      status: string;
      rounds_completed: number;
      rounds_total: number;
      paper_total: number;
      target_paper: number;
      error_message: string | null;
      rounds: Array<{
        round_index: number;
        situation_tag: string;
        morale: number;
        paper_sold: number;
        manager_message: string;
        worker_message: string;
        worker_morale_rationale: string;
      }>;
    };

    for (const r of detail.rounds.filter((r) => r.round_index > lastSeenRound)) {
      console.log(
        `── Round ${r.round_index} [${r.situation_tag}] morale=${r.morale} paper=${r.paper_sold} ──`,
      );
      console.log(`  Mgr:    ${r.manager_message}`);
      console.log(`  Worker: ${r.worker_message}`);
      console.log(`  (why: ${r.worker_morale_rationale})\n`);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
