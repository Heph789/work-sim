// Recharts wrapper: morale curve. x = round_index, y = morale (0–100).
// Just the worker's morale in v1 (manager has no morale per locked-decisions
// #6 — schema reserves the column but the runner doesn't update it).

'use client';

import type { RoundView } from '@work-sim/shared';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface MoraleChartProps {
  rounds: RoundView[];
}

export function MoraleChart({ rounds }: MoraleChartProps) {
  const data = rounds.map((r) => ({ round: r.round_index, morale: r.morale }));

  return (
    <div className="bg-white border rounded p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-2">Worker morale</h3>
      <div className="h-48">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            no rounds yet
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
