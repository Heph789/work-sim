// Plain horizontal progress bar — used in the run-detail header for
// `paper_total / target_paper`. Pure presentational.

export interface ProgressBarProps {
  value: number;
  max: number;
  /** Optional override for the right-side percentage label. */
  label?: string;
}

export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(100, Math.max(0, Math.round((100 * value) / safeMax)));
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div
          className="h-full bg-blue-600 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 tabular-nums w-16 text-right">
        {label ?? `${pct}%`}
      </span>
    </div>
  );
}
