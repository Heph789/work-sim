// Colored pill rendering a RunStatus. Used in the runs list table and the
// run-detail header. Pure presentational — no data fetching or state.

import type { RunStatus } from '@work-sim/shared';

export interface StatusPillProps {
  status: RunStatus;
}

/** Tailwind classes per status. Keep in sync with RunStatus enum. */
const STATUS_STYLES: Record<RunStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-yellow-100 text-yellow-800',
};

export function StatusPill({ status }: StatusPillProps) {
  // TODO: render <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[status]}`}>{status}</span>.
  void STATUS_STYLES;
  void status;
  return null;
}
