// Per-avatar morale chart for the drilldown page. Recharts line chart with
// x = round_index, y = end-of-round morale (0–100). Reuses the styling that
// was on the prior single-worker `morale-chart.tsx`.
//
// Renders a placeholder when the avatar has no morale rows (managers in v1,
// or rounds_completed = 0).

'use client';

import type { DrilldownRoundEntry } from '@work-sim/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface AvatarMoraleChartProps {
  /** Drilldown per-round entries for the focused avatar, sorted by round_index. */
  perRound: DrilldownRoundEntry[];
}

export function AvatarMoraleChart({ perRound }: AvatarMoraleChartProps) {
  // Only points with a real morale value go into the chart — managers in v1
  // produce NULL morale rows, which we don't want to plot at zero.
  const data = perRound
    .filter((r) => r.morale !== null)
    .map((r) => ({ round: r.round_index, morale: r.morale as number }));

  return (
    <div className="bg-white border rounded p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-2">Morale</h3>
      <div className="h-48">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            no morale data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="round" stroke="#6b7280" fontSize={12} />
              <YAxis domain={[0, 100]} stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(v: number) => [v, 'morale']}
                labelFormatter={(l: number) => `round ${l}`}
              />
              <Line
                type="monotone"
                dataKey="morale"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
