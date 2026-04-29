// Per-avatar dashboard table. One row per avatar; the manager appears first
// with em-dashes in the morale / paper columns (manager has no morale and no
// paper output in v1 — design.md §15).
//
// Each row links through to the avatar drilldown page so users can pivot
// from "team-level glance" to "this person's interactions".

'use client';

import Link from 'next/link';
import type { DashboardPerAvatar } from '@work-sim/shared';
import { MoraleSparkline } from './morale-sparkline';

export interface AvatarTableProps {
  runId: string;
  /** Pre-aggregated per-avatar dashboard data from RunDetail.per_avatar. */
  perAvatar: DashboardPerAvatar[];
}

export function AvatarTable({ runId, perAvatar }: AvatarTableProps) {
  return (
    <div className="bg-white border rounded overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Role</th>
            <th className="px-4 py-2 text-right">Morale</th>
            <th className="px-4 py-2 text-right">Cumulative</th>
            <th className="px-4 py-2 text-right">Last round</th>
            <th className="px-4 py-2">Trend</th>
          </tr>
        </thead>
        <tbody>
          {perAvatar.map((row) => {
            const isManager = row.role_in_sim === 'manager';
            const lastRoundPaper =
              row.paper_per_round.length === 0
                ? null
                : row.paper_per_round[row.paper_per_round.length - 1]!;
            return (
              <tr key={row.avatar_id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/runs/${runId}/avatars/${row.avatar_id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-700">{row.role_label}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {row.last_morale === null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    row.last_morale
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {isManager || row.paper_total === null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    row.paper_total
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {isManager || lastRoundPaper === null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    lastRoundPaper
                  )}
                </td>
                <td className="px-4 py-2">
                  <MoraleSparkline values={row.morale_curve} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
