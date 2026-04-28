// Route: GET /new
// Screen: Setup form. Two side-by-side agent panels (manager + worker), then
// simulation parameters, then a Run button.
//
// Behavior (per docs/initial-prototype/frontend.md "Screen 2"):
// - "Load preset" dropdown filters to the panel's role.
// - Selecting a preset overwrites all five fields. Editing after is fine; the
//   dropdown shows "(custom)" once any field diverges.
// - Defaults on first visit (no localStorage): Michael Scott (manager), Jim
//   Halpert (worker), target 500, rounds 10, model gpt-4.1, temperature 0.8.
// - Persist last-used values in localStorage under 'work-sim:setup-draft'.
// - Validate client-side with Zod (CreateRunRequestSchema-equivalent) before POST.
// - On submit: POST /runs, then router.push(`/runs/${id}`).

'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { AgentProfile } from '@work-sim/shared';
import { AgentForm } from '@/components/agent-form';
import { createRun } from '@/lib/api';

/** localStorage key for persisting the in-progress form. */
const DRAFT_KEY = 'work-sim:setup-draft';

/** Default model dropdown options. Kept in sync with API's accepted models. */
const MODEL_OPTIONS = ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'] as const;

/** Shape of the persisted draft (everything in the form). */
interface SetupDraft {
  manager: AgentProfile;
  worker: AgentProfile;
  target_paper: number;
  rounds_total: number;
  model: string;
  temperature: number;
}

export default function NewRunPage() {
  const router = useRouter();

  // TODO: initialize state from localStorage (DRAFT_KEY); on first visit fall
  // back to defaults derived from PRESETS (Michael Scott / Jim Halpert).
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TODO: persist `draft` to localStorage on every change (debounced or direct).
  useEffect(() => {
    void DRAFT_KEY;
    void draft;
  }, [draft]);

  /** Submit handler. Validates, POSTs, navigates. */
  async function onRun() {
    if (!draft) return;
    setSubmitting(true);
    setError(null);
    try {
      // TODO: client-side Zod validation here (mirror CreateRunRequestSchema).
      const { id } = await createRun({
        agents: [draft.manager, draft.worker],
        target_paper: draft.target_paper,
        rounds_total: draft.rounds_total,
        model: draft.model,
        temperature: draft.temperature,
      });
      router.push(`/runs/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold mb-6">New run</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* TODO: render <AgentForm role="manager" value={draft.manager} onChange={...} /> */}
        {/* TODO: render <AgentForm role="worker" value={draft.worker} onChange={...} /> */}
        {void AgentForm}
      </div>
      {/* TODO: render simulation parameters block (target, rounds, model select, temperature). */}
      {/* TODO: render Run button (disabled while submitting). */}
      {/* TODO: render error banner when `error` is set. */}
      {void MODEL_OPTIONS}
      {void onRun}
      {void submitting}
      {void error}
    </>
  );
}
