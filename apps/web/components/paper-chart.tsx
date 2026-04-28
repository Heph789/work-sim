// Recharts wrapper: paper sold per round, as a bar chart. x = round_index, y = paper_sold.

'use client';

import type { RoundView } from '@work-sim/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface PaperChartProps {
  rounds: RoundView[];
}

export function PaperChart({ rounds }: PaperChartProps) {
  const data = rounds.map((r) => ({ round: r.round_index, paper_sold: r.paper_sold }));

  return (
    <div className="bg-white border rounded p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-2">Paper sold per round</h3>
      <div className="h-48">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">
            no rounds yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="round" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(v: number) => [v, 'paper sold']}
                labelFormatter={(l: number) => `round ${l}`}
              />
              <Bar dataKey="paper_sold" fill="#2563eb" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
