// Inline SVG morale sparkline for the avatar dashboard table. Custom-rendered
// (not Recharts) because the table can have many rows and a full chart per
// row is heavy.
//
// Conventions:
// - x: round_index, y: morale (0–100).
// - Empty array → renders a faint placeholder hyphen, never empty SVG.
// - No tooltips, no axes — the row's textual cells already show current /
//   last-round morale numerically.

'use client';

export interface MoraleSparklineProps {
  /** Morale values, oldest → newest. NULLs are skipped (e.g. manager rows). */
  values: (number | null)[];
  /** Pixel width. Default 80px — tuned for the dashboard table. */
  width?: number;
  /** Pixel height. Default 24px. */
  height?: number;
}

/**
 * Map a morale value (0–100) to an SVG y-coordinate inside the height range.
 * Higher morale renders higher on screen — invert the axis since SVG y grows
 * downward.
 */
function moraleToY(morale: number, height: number): number {
  const clamped = Math.max(0, Math.min(100, morale));
  // 1px top/bottom padding so the line never clips the box edge.
  return height - 1 - (clamped / 100) * (height - 2);
}

export function MoraleSparkline({ values, width = 80, height = 24 }: MoraleSparklineProps) {
  const points = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);

  if (points.length === 0) {
    return <span className="text-gray-300">—</span>;
  }

  if (points.length === 1) {
    // Single point — render a small dot rather than a degenerate line.
    const cx = width / 2;
    const cy = moraleToY(points[0]!.v, height);
    return (
      <svg width={width} height={height} aria-hidden="true">
        <circle cx={cx} cy={cy} r={2} fill="#2563eb" />
      </svg>
    );
  }

  const xStep = width / (points.length - 1);
  const path = points
    .map((p, idx) => {
      const x = idx * xStep;
      const y = moraleToY(p.v, height);
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={path} fill="none" stroke="#2563eb" strokeWidth={1.5} />
    </svg>
  );
}
