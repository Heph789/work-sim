// Route: GET /
// Screen: Runs list. Table of past + in-progress runs, "New run" button.
//
// Behavior (per docs/many-workers/design.md §14):
// - Newest first (the API returns rows in that order).
// - Auto-refresh every 5s while any row is pending|running. Stops once all
//   rows are terminal — handled inside useRuns.
// - Empty state: "No runs yet — start your first sim."
// - Row click → /runs/:id (the dashboard).
// - The single-worker prototype showed both names; with N workers we show
//   the manager + a worker count.

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
        <Link href="/new" className="btn-primary">
          New run
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          Failed to load runs: {error.message}
        </div>
      )}

      {loading && runs.length === 0 ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="bg-white border rounded p-8 text-center text-gray-600">
          No runs yet — start your first sim.
        </div>
      ) : (
        <div className="bg-white border rounded overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2">Manager</th>
                <th className="px-4 py-2 text-right">Workers</th>
                <th className="px-4 py-2 text-right">Rounds</th>
                <th className="px-4 py-2 text-right">Target</th>
                <th className="px-4 py-2 text-right">Sold</th>
                <th className="px-4 py-2">Hit?</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link href={`/runs/${r.id}`} className="block text-blue-700 hover:underline">
                      {formatRelative(r.created_at)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.manager_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.n_workers}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.rounds_completed}/{r.rounds_total}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.target_paper}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.paper_total}</td>
                  <td className="px-4 py-2">
                    {r.hit_target === null ? (
                      <span className="text-gray-400">—</span>
                    ) : r.hit_target ? (
                      <span className="text-green-700">✓</span>
                    ) : (
                      <span className="text-red-700">✗</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Format an absolute unix-ms timestamp as relative time ("2 min ago"). */
function formatRelative(createdAtMs: number): string {
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - createdAtMs) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return new Date(createdAtMs).toISOString().slice(0, 10);
}
