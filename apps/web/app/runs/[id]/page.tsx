// Route: GET /runs/[id]
// Screen: Run detail. Live (polling) or completed view. The most important
// screen — shows a run as it unfolds.
//
// Behavior (per docs/initial-prototype/frontend.md "Screen 3"):
// - Header: agent names + arrow, current round / total, target / sold / pace,
//   progress bar, status pill.
// - Left column: transcript of completed rounds + "generating round N..." while
//   running.
// - Right column: morale curve + paper-sold-per-round bar chart (Recharts).
// - On completion: ✓ "Hit target: X/Y" or ✗ "Missed target: X/Y" banner.
// - On failure: red banner "Run failed at round N." + error_message.

'use client';

import { use } from 'react';
import Link from 'next/link';
import type { AgentProfile } from '@work-sim/shared';
import { useRunPolling } from '@/hooks/use-run-polling';
import { ProgressBar } from '@/components/progress-bar';
import { StatusPill } from '@/components/status-pill';
import { Transcript } from '@/components/transcript';
import { MoraleChart } from '@/components/morale-chart';
import { PaperChart } from '@/components/paper-chart';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function RunDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { run, notFound, error } = useRunPolling(id);

  if (notFound) {
    return (
      <>
        <Link href="/" className="text-sm text-gray-600 hover:underline">◀ Back to runs</Link>
        <div className="mt-6 bg-white border rounded p-8 text-center text-gray-700">
          Run <code className="text-sm">{id}</code> not found.
        </div>
      </>
    );
  }

  if (!run) {
    return (
      <>
        <Link href="/" className="text-sm text-gray-600 hover:underline">◀ Back to runs</Link>
        <div className="mt-6 text-sm text-gray-500">Loading run…</div>
        {error && (
          <div className="mt-3 text-sm text-red-700">
            Failed to load: {error.message}
          </div>
        )}
      </>
    );
  }

  const manager = run.config.agents.find((a: AgentProfile) => a.role_in_sim === 'manager');
  const worker = run.config.agents.find((a: AgentProfile) => a.role_in_sim === 'worker');
  const managerName = manager?.name ?? 'Manager';
  const workerName = worker?.name ?? 'Worker';

  const pace = describePace({
    roundsCompleted: run.rounds_completed,
    roundsTotal: run.rounds_total,
    paperTotal: run.paper_total,
    targetPaper: run.target_paper,
  });

  const isCompleted = run.status === 'completed';
  const hitTarget = isCompleted && run.paper_total >= run.target_paper;

  return (
    <>
      <Link href="/" className="text-sm text-gray-600 hover:underline">◀ Back to runs</Link>

      <section className="mt-4 mb-6 bg-white border rounded p-5 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-xl font-semibold">
            {managerName} <span className="text-gray-400">→</span> {workerName}
          </h2>
          <StatusPill status={run.status} />
        </div>

        <div className="text-sm text-gray-600">
          Round {Math.min(run.rounds_completed + (run.status === 'running' ? 1 : 0), run.rounds_total)} of{' '}
          {run.rounds_total} · target {run.target_paper} · sold {run.paper_total} · {pace}
        </div>

        <ProgressBar
          value={run.paper_total}
          max={run.target_paper}
          label={`${run.paper_total} / ${run.target_paper}`}
        />
      </section>

      {run.status === 'failed' && (
        <div className="mb-6 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <div className="font-medium">
            Run failed{run.failed_at_round !== null ? ` at round ${run.failed_at_round}` : ''}.
          </div>
          {run.error_message && (
            <div className="mt-1 text-red-800 whitespace-pre-wrap">{run.error_message}</div>
          )}
        </div>
      )}

      {isCompleted && (
        <div
          className={`mb-6 rounded border px-4 py-3 text-sm ${
            hitTarget
              ? 'border-green-200 bg-green-50 text-green-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          <span className="font-medium">
            {hitTarget ? '✓ Hit target' : '✗ Missed target'}: {run.paper_total} / {run.target_paper}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <Transcript
            rounds={run.rounds}
            status={run.status}
            expectedRounds={run.rounds_total}
            managerName={managerName}
            workerName={workerName}
          />
        </div>
        <div className="space-y-6">
          <MoraleChart rounds={run.rounds} />
          <PaperChart rounds={run.rounds} />
        </div>
      </div>
    </>
  );
}

/** Quick textual pace summary based on completed rounds vs target. */
function describePace(args: {
  roundsCompleted: number;
  roundsTotal: number;
  paperTotal: number;
  targetPaper: number;
}): string {
  const { roundsCompleted, roundsTotal, paperTotal, targetPaper } = args;
  if (roundsCompleted === 0) return 'just started';
  if (roundsCompleted >= roundsTotal) {
    return paperTotal >= targetPaper ? 'target hit' : 'fell short';
  }
  const projected = Math.round((paperTotal / roundsCompleted) * roundsTotal);
  if (projected >= targetPaper) return `on pace (projected ${projected})`;
  return `behind pace (projected ${projected})`;
}
