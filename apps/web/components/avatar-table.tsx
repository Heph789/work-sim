// Per-avatar dashboard table. One row per avatar; the manager appears first
// with em-dashes in the morale / paper columns (manager has no morale and no
// paper output in v1 — design.md §15).
//
// Each row links through to the avatar drilldown page so users can pivot
// from "team-level glance" to "this person's interactions".

'use client';

import Link from 'next/link';
import type { AvatarView, RoundAvatarView } from '@work-sim/shared';
import { MoraleSparkline } from './morale-sparkline';

export interface AvatarTableProps {
  runId: string;
  avatars: AvatarView[];
  /** End-of-round per-avatar snapshots from RunDetail. May span multiple avatars and rounds. */
  roundAvatars: RoundAvatarView[];
}

/**
 * Per-avatar derived row data. Computed from the flat `roundAvatars` list so
 * the table renders without re-querying the API.
 */
interface AvatarRowData {
  avatar: AvatarView;
  /** Morale series in round order, with NULL for rounds where this avatar has no value (managers). */
  moraleSeries: (number | null)[];
  /** Most recent non-null morale, or null if the avatar has never produced one. */
  currentMorale: number | null;
  /** Cumulative paper_sold across all rounds (sum of per-round paper_sold). */
  cumulativePaper: number;
  /** Last completed round's paper_sold, or null if none. */
  lastRoundPaper: number | null;
}

/**
 * Reshape the flat per-(round, avatar) list into per-avatar derived data.
 * Sorts by round_index defensively even though the API returns sorted.
 */
function buildRows(avatars: AvatarView[], roundAvatars: RoundAvatarView[]): AvatarRowData[] {
  // Group by avatar_id, then sort each group by round_index.
  const byAvatar = new Map<string, RoundAvatarView[]>();
  for (const ra of roundAvatars) {
    const arr = byAvatar.get(ra.avatar_id) ?? [];
    arr.push(ra);
    byAvatar.set(ra.avatar_id, arr);
  }
  for (const arr of byAvatar.values()) {
    arr.sort((a, b) => a.round_index - b.round_index);
  }

  return avatars.map((avatar) => {
    const series = byAvatar.get(avatar.id) ?? [];
    const moraleSeries = series.map((s) => s.morale);
    const lastWithMorale = [...series].reverse().find((s) => s.morale !== null);
    const cumulativePaper = series.reduce((sum, s) => sum + (s.paper_sold ?? 0), 0);
    const lastRoundPaper = series.length === 0 ? null : (series[series.length - 1]!.paper_sold);
    return {
      avatar,
      moraleSeries,
      currentMorale: lastWithMorale?.morale ?? null,
      cumulativePaper,
      lastRoundPaper,
    };
  });
}

export function AvatarTable({ runId, avatars, roundAvatars }: AvatarTableProps) {
  const rows = buildRows(avatars, roundAvatars);

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
          {rows.map((row) => {
            const isManager = row.avatar.role_in_sim === 'manager';
            return (
              <tr key={row.avatar.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/runs/${runId}/avatars/${row.avatar.id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {row.avatar.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-700">{row.avatar.role_label}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {row.currentMorale === null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    row.currentMorale
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {isManager ? <span className="text-gray-300">—</span> : row.cumulativePaper}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {isManager || row.lastRoundPaper === null ? (
                    <span className="text-gray-300">—</span>
                  ) : (
                    row.lastRoundPaper
                  )}
                </td>
                <td className="px-4 py-2">
                  <MoraleSparkline values={row.moraleSeries} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
