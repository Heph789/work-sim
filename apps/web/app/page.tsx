// Route: GET /
// Screen: Runs list. Table of past + in-progress runs, "New run" button.
//
// Behavior (per docs/initial-prototype/frontend.md "Screen 1"):
// - Newest first.
// - Auto-refresh every 5s while any row is pending|running. Stop polling
//   once all rows are terminal.
// - Empty state: "No runs yet — start your first sim."
// - Row click → /runs/:id.

'use client';

import Link from 'next/link';
import { useRuns } from '@/hooks/use-runs';
import { StatusPill } from '@/components/status-pill';

export default function RunsListPage() {
  const { runs, loading, error } = useRuns();

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <Link href="/new" className="btn-primary">New run</Link>
      </div>
      {/* TODO: render <Spinner /> while loading; <EmptyState /> when runs.length === 0. */}
      {/* TODO: render error banner when `error` is set. */}
      {/* TODO: render <table> with columns: Created | Manager | Worker | Rounds | Target | Hit? | Status. */}
      {/* TODO: each row is a <Link href={`/runs/${r.id}`}> so row click navigates. */}
      {void loading}
      {void error}
      {void StatusPill}
      {void runs}
    </>
  );
}

/** Format an absolute unix-ms timestamp as relative time ("2 min ago"). */
// TODO: implement formatRelative(createdAtMs: number): string.
