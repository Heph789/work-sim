// Plain horizontal progress bar — used in the run-detail header for
// `paper_total / target_paper`. Pure presentational.

export interface ProgressBarProps {
  value: number;
  max: number;
  /** Optional override for the right-side percentage label. */
  label?: string;
}

export function ProgressBar({ value, max, label }: ProgressBarProps) {
  // TODO: clamp pct = min(100, round(100 * value / max)).
  // TODO: render outer <div> with bg-gray-200 + inner <div> with width: pct% and bg-blue-600.
  // TODO: append `label ?? `${pct}%`` on the right.
  void value;
  void max;
  void label;
  return null;
}
