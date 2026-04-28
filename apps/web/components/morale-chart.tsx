// Recharts wrapper: morale curve. x = round_index, y = morale (0–100).
// Just the worker's morale in v1 (manager has no morale per locked-decisions
// #6 — schema reserves the column but the runner doesn't update it).

'use client';

import type { RoundView } from '@work-sim/shared';
// DEPENDENCY: recharts — declared in package.json. Imported lazily-friendly:
// `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`.
// TODO: import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export interface MoraleChartProps {
  rounds: RoundView[];
}

export function MoraleChart({ rounds }: MoraleChartProps) {
  // TODO: project rounds → [{ round: round_index, morale }].
  // TODO: render <ResponsiveContainer><LineChart data={...}>...</LineChart></ResponsiveContainer>.
  // TODO: y-axis fixed to [0, 100]; show grid.
  void rounds;
  return null;
}
