// Recharts wrapper: paper sold per round, as a bar chart. x = round_index, y = paper_sold.

'use client';

import type { RoundView } from '@work-sim/shared';
// DEPENDENCY: recharts.
// TODO: import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export interface PaperChartProps {
  rounds: RoundView[];
}

export function PaperChart({ rounds }: PaperChartProps) {
  // TODO: project rounds → [{ round, paper_sold }].
  // TODO: render <ResponsiveContainer><BarChart data={...}>...</BarChart></ResponsiveContainer>.
  void rounds;
  return null;
}
