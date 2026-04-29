// Route: GET /runs/[id]
// Screen: Dashboard (per docs/many-workers/design.md §14.1).
//
// Replaces the prior single-worker run-detail screen. The transcript view is
// gone — with N workers + peer interactions a flat transcript no longer fits;
// instead the dashboard shows per-avatar summary rows, and clicking a row
// routes to the avatar drilldown.
//
// Behavior:
// - Header: manager name + worker count + status pill, target/sold/pace,
//   progress bar.
// - Avatar table: one row per avatar (manager first), with current morale,
//   cumulative paper, last-round paper, and morale sparkline.
// - Live-polled (2s while pending|running, stops on terminal status).
// - Failure banner / completion banner — same visual language as the prior
//   single-worker view.

'use client';

import { use } from 'react';
import Link from 'next/link';
import type { AvatarView } from '@work-sim/shared';
import { useRunPolling } from '@/hooks/use-run-polling';
import { DashboardHeader } from '@/components/dashboard-header';
import { AvatarTable } from '@/components/avatar-table';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function RunDashboardPage({ params }: PageProps) {
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

  const manager: AvatarView | undefined = run.avatars.find((a) => a.role_in_sim === 'manager');
  const workerCount = run.avatars.filter((a) => a.role_in_sim === 'worker').length;
  const managerName = manager?.name ?? 'Manager';

  const paceText = describePace({
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

      <DashboardHeader
        managerName={managerName}
        workerCount={workerCount}
        status={run.status}
        roundsCompleted={run.rounds_completed}
        roundsTotal={run.rounds_total}
        targetPaper={run.target_paper}
        paperTotal={run.paper_total}
        paceText={paceText}
      />

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

      <AvatarTable
        runId={run.id}
        avatars={run.avatars}
        roundAvatars={run.round_avatars}
      />
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
