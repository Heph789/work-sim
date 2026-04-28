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
  managerName?: string;
  workerName?: string;
}

/** Pixels-from-bottom we treat as "still pinned". Generous so a click-drag of a few px doesn't unpin. */
const PIN_THRESHOLD_PX = 32;

export function Transcript({
  rounds,
  status,
  expectedRounds,
  managerName,
  workerName,
}: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const wasPinnedRef = useRef<boolean>(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasPinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [rounds.length]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasPinnedRef.current = distanceFromBottom < PIN_THRESHOLD_PX;
  }

  const isActive = status === 'pending' || status === 'running';
  const showPlaceholder = isActive && rounds.length < expectedRounds;
  const isEmpty = rounds.length === 0 && !showPlaceholder;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="bg-white border rounded p-4 max-h-[70vh] overflow-y-auto"
    >
      {isEmpty && (
        <div className="text-sm text-gray-500 italic">No rounds yet.</div>
      )}
      {rounds.map((r) => (
        <RoundBlock
          key={r.round_index}
          round={r}
          managerName={managerName}
          workerName={workerName}
        />
      ))}
      {showPlaceholder && (
        <div className="text-sm text-gray-500 italic mt-3 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          generating round {rounds.length + 1}…
        </div>
      )}
    </div>
  );
}
