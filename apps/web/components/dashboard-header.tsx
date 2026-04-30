// Run-page header. Shown on the dashboard above the avatar table; renders
// run-wide stats, the progress bar, and the status pill. Pure presentational
// — gets pre-formatted numbers from the parent.
//
// Layout (per docs/many-workers/design.md §14.1):
// - Title row: "<Manager> + N workers" + status pill.
// - Stat row: round X/Y · target T · sold S · pace text.
// - Progress bar (paper_total / target_paper).

'use client';

import type { RunStatus } from '@work-sim/shared';
import { ProgressBar } from './progress-bar';
import { StatusPill } from './status-pill';

export interface DashboardHeaderProps {
  managerName: string;
  workerCount: number;
  status: RunStatus;
  roundsCompleted: number;
  roundsTotal: number;
  targetPaper: number;
  paperTotal: number;
  /** Pre-formatted human-readable pace summary, e.g. "on pace (projected 540)". */
  paceText: string;
}

export function DashboardHeader({
  managerName,
  workerCount,
  status,
  roundsCompleted,
  roundsTotal,
  targetPaper,
  paperTotal,
  paceText,
}: DashboardHeaderProps) {
  // While running, the round currently being computed is roundsCompleted+1.
  // On completion / failure we just display the final completed count.
  const roundDisplay = Math.min(
    roundsCompleted + (status === 'running' ? 1 : 0),
    roundsTotal,
  );

  return (
    <section className="mt-4 mb-6 bg-white border rounded p-5 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-semibold">
          {managerName}{' '}
          <span className="text-gray-400 font-normal">
            · {workerCount} {workerCount === 1 ? 'worker' : 'workers'}
          </span>
        </h2>
        <StatusPill status={status} />
      </div>

      <div className="text-sm text-gray-600">
        Round {roundDisplay} of {roundsTotal} · target {targetPaper} · sold {paperTotal} · {paceText}
      </div>

      <ProgressBar
        value={paperTotal}
        max={targetPaper}
        label={`${paperTotal} / ${targetPaper}`}
      />
    </section>
  );
}
