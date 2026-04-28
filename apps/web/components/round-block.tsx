// One block in the transcript: round header + situation tag + manager line +
// worker line + footer (morale + paper sold).
//
// Click on the situation_tag chip → tooltip with the tag's description.
// Tag descriptions live in @work-sim/shared/situation-tags.ts.

'use client';

import type { RoundView } from '@work-sim/shared';

export interface RoundBlockProps {
  round: RoundView;
  /** Optional: agent display names from config; falls back to "Manager" / "Worker". */
  managerName?: string;
  workerName?: string;
}

export function RoundBlock(props: RoundBlockProps) {
  const { round } = props;
  // TODO: header — "── Round {round_index} ──", muted small text.
  // TODO: situation_tag chip with tooltip (lookup in SITUATION_TAGS for description).
  // TODO: render manager line: <strong>{managerName}:</strong> {manager_message}.
  // TODO: render worker line: <strong>{workerName}:</strong> {worker_message}.
  // TODO: footer — "morale {morale} • {paper_sold} sold", muted.
  void round;
  return null;
}
