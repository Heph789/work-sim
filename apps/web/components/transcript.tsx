// Left-column transcript on the run-detail screen. Renders one block per
// completed round; appends a "generating round N..." placeholder while the
// run is still active and we're between rounds.
//
// Auto-scroll behavior:
// - When `rounds.length` increases, scroll to bottom.
// - UNLESS the user has scrolled up: track scrollTop on the container and
//   skip auto-scroll when it's not pinned to (or near) the bottom.

'use client';

import { useEffect, useRef } from 'react';
import type { RoundView, RunStatus } from '@work-sim/shared';
import { RoundBlock } from './round-block';

export interface TranscriptProps {
  /** Completed rounds, ascending by round_index. */
  rounds: RoundView[];
  /** Current run status — drives whether we render the "generating..." footer. */
  status: RunStatus;
  /** rounds_total — used so we don't render the placeholder past the last round. */
  expectedRounds: number;
}

export function Transcript({ rounds, status, expectedRounds }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasPinnedRef = useRef<boolean>(true);

  // TODO: on rounds.length change, if wasPinnedRef.current is true,
  // scrollRef.current.scrollTop = scrollRef.current.scrollHeight.
  useEffect(() => {
    void scrollRef;
    void wasPinnedRef;
  }, [rounds.length]);

  // TODO: onScroll handler updates wasPinnedRef based on whether the user is
  // near the bottom (e.g., scrollHeight - scrollTop - clientHeight < 32px).

  const isActive = status === 'pending' || status === 'running';
  const showPlaceholder = isActive && rounds.length < expectedRounds;

  return (
    <div className="bg-white border rounded p-4 max-h-[70vh] overflow-y-auto" ref={scrollRef}>
      {/* TODO: render rounds.map(r => <RoundBlock key={r.round_index} round={r} />). */}
      {void RoundBlock}
      {void rounds}
      {showPlaceholder && (
        // TODO: render a muted "⠋ generating round N..." line where N = rounds.length + 1.
        <div className="text-sm text-gray-500 italic">generating…</div>
      )}
    </div>
  );
}
