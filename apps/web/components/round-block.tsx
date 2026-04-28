// One block in the transcript: round header + situation tag + manager line +
// worker line + footer (morale + paper sold).
//
// The situation_tag chip carries the human-readable description as a native
// title tooltip — no popover library, no portal layers. Tag descriptions live
// in @work-sim/shared/situation-tags.ts.

'use client';

import type { RoundView } from '@work-sim/shared';
import { SITUATION_TAGS } from '@work-sim/shared';

export interface RoundBlockProps {
  round: RoundView;
  /** Optional: agent display names from config; falls back to "Manager" / "Worker". */
  managerName?: string;
  workerName?: string;
}

export function RoundBlock({ round, managerName, workerName }: RoundBlockProps) {
  const tagDesc = SITUATION_TAGS.find((t) => t.tag === round.situation_tag)?.description;

  return (
    <div className="py-3 border-b last:border-b-0">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-500 uppercase tracking-wide">
          ── Round {round.round_index} ──
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 cursor-help"
          title={tagDesc ?? round.situation_tag}
        >
          {round.situation_tag}
        </span>
      </div>

      <p className="text-sm mb-2 whitespace-pre-wrap">
        <strong className="text-gray-900">{managerName ?? 'Manager'}:</strong>{' '}
        <span className="text-gray-800">{round.manager_message}</span>
      </p>
      <p className="text-sm mb-2 whitespace-pre-wrap">
        <strong className="text-gray-900">{workerName ?? 'Worker'}:</strong>{' '}
        <span className="text-gray-800">{round.worker_message}</span>
      </p>

      <div className="text-xs text-gray-500 mt-2">
        morale {round.morale} · {round.paper_sold} sold
      </div>
    </div>
  );
}
