// Route: GET /runs/[id]
// Screen: Run detail. Live (polling) or completed view. The most important
// screen — shows a run as it unfolds.
//
// Behavior (per docs/initial-prototype/frontend.md "Screen 3"):
// - Header: agent names + arrow, current round / total, target / sold / pace,
//   progress bar, status pill.
// - Left column: transcript of completed rounds + "generating round N..." while
//   running. Auto-scroll to bottom on new round, unless the user has scrolled up.
// - Right column: morale curve + paper-sold-per-round bar chart (Recharts).
// - On completion: ✓ "Hit target: X/Y" or ✗ "Missed target: X/Y" banner.
// - On failure: red banner "Run failed at round N." + error_message.
//   "Start a new run with the same config" button (deferred if non-trivial).

'use client';

import { use } from 'react';
import Link from 'next/link';
import { useRunPolling } from '@/hooks/use-run-polling';
import { ProgressBar } from '@/components/progress-bar';
import { StatusPill } from '@/components/status-pill';
import { Transcript } from '@/components/transcript';
import { MoraleChart } from '@/components/morale-chart';
import { PaperChart } from '@/components/paper-chart';

/**
 * Next 15 passes route params as a Promise to async page components; for client
 * components, React's `use()` hook unwraps it.
 */
interface PageProps {
  params: Promise<{ id: string }>;
}

export default function RunDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const run = useRunPolling(id);

  // TODO: render loading state while run === null.
  // TODO: extract manager/worker names from run.config.agents for the header.
  // TODO: compute on_pace_description from rounds_completed / paper_total / target.

  return (
    <>
      <Link href="/" className="text-sm text-gray-600 hover:underline">◀ Back to runs</Link>

      {/* Header card: names → progress → status pill */}
      <section className="mt-4 mb-6 bg-white border rounded p-4">
        {/* TODO: <h2>{managerName} → {workerName}</h2> */}
        {/* TODO: round X of Y · target N · sold M · {pace} */}
        {/* TODO: <ProgressBar value={paper_total} max={target_paper} /> */}
        {/* TODO: <StatusPill status={run.status} /> */}
        {void ProgressBar}
        {void StatusPill}
      </section>

      {/* Failure banner — only when status === 'failed'. */}
      {/* TODO: red banner with error_message + failed_at_round. */}

      {/* Completion banner — only when status === 'completed'. */}
      {/* TODO: green ✓ if paper_total >= target_paper, red ✗ otherwise. */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          {/* TODO: <Transcript rounds={run.rounds} status={run.status} expectedRounds={run.rounds_total} /> */}
          {void Transcript}
        </div>
        <div className="space-y-6">
          {/* TODO: <MoraleChart rounds={run.rounds} /> */}
          {/* TODO: <PaperChart rounds={run.rounds} /> */}
          {void MoraleChart}
          {void PaperChart}
        </div>
      </div>
      {void run}
    </>
  );
}
