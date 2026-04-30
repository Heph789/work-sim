// Route: GET /new
// Screen: Setup form. Manager panel + N-worker editor + simulation params +
// Run button.
//
// Behavior (per docs/many-workers/design.md §14 + design-doc DESIGN.md §2.6):
// - "Load preset" dropdowns filter by role.
// - Selecting a preset overwrites all five fields of the selected slot.
//   Editing after is fine; the dropdown shows "(custom)" once any field
//   diverges.
// - Defaults on first visit: Michael Scott (manager) + Jim Halpert (worker),
//   target 500, rounds 10, model gpt-4.1, temperature 0.8.
// - Persist last-used values in localStorage under 'work-sim:setup-draft-v2'.
//   Bumped from v1 because the shape changed (workers[] instead of single
//   worker). Any older draft is silently discarded.
// - Validate client-side with Zod before POST.
// - On submit: POST /runs with `avatars: [manager, ...workers]`, then
//   router.push(`/runs/${id}`).

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { getPreset } from '@work-sim/shared';
import { AvatarForm } from '@/components/avatar-form';
import { WorkersListEditor } from '@/components/workers-list-editor';
import { presetToProfile, type AvatarDraft } from '@/components/preset-dropdown';
import { createRun } from '@/lib/api';

/** Bumped from the prior single-worker draft key so old drafts don't try to deserialize. */
const DRAFT_KEY = 'work-sim:setup-draft-v2';

const MODEL_OPTIONS = ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'] as const;

interface SetupDraft {
  manager: AvatarDraft;
  /** N≥1 workers. Order is the deterministic worker iteration order. */
  workers: AvatarDraft[];
  target_paper: number;
  rounds_total: number;
  model: string;
  temperature: number;
}

/** Mirrors CreateRunRequestSchema in apps/api/src/routes/schemas.ts. */
const AvatarProfileZ = z.object({
  role_in_sim: z.enum(['manager', 'worker']),
  name: z.string().min(1).max(80),
  role_label: z.string().min(1).max(80),
  personality: z.string().min(1).max(2000),
  values: z.string().min(1).max(2000),
  baseline_output: z.number().int().min(0).max(100),
});

const SetupZ = z
  .object({
    manager: AvatarProfileZ,
    workers: z.array(AvatarProfileZ).min(1),
    target_paper: z.number().int().min(1),
    rounds_total: z.number().int().min(1).max(100),
    model: z.string().min(1),
    temperature: z.number().min(0).max(2),
  })
  .refine((d) => d.manager.role_in_sim === 'manager', {
    message: 'manager panel must contain a manager',
    path: ['manager'],
  })
  .refine((d) => d.workers.every((w) => w.role_in_sim === 'worker'), {
    message: 'all worker rows must have role_in_sim = worker',
    path: ['workers'],
  })
  .refine((d) => d.workers.every((w) => w.baseline_output >= 1), {
    message: 'every worker baseline_output must be ≥ 1',
    path: ['workers'],
  });

function defaultDraft(): SetupDraft {
  const michael = getPreset('michael-scott');
  const jim = getPreset('jim-halpert');
  if (!michael || !jim) {
    throw new Error('preset defaults missing — check @work-sim/shared/presets');
  }
  return {
    manager: presetToProfile(michael),
    workers: [presetToProfile(jim)],
    target_paper: 500,
    rounds_total: 10,
    model: 'gpt-4.1',
    temperature: 0.8,
  };
}

function loadDraft(): SetupDraft {
  if (typeof window === 'undefined') return defaultDraft();
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return defaultDraft();
    const parsed = SetupZ.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to defaults on any parse / shape error
  }
  return defaultDraft();
}

export default function NewRunPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(loadDraft());
  }, []);

  useEffect(() => {
    if (!draft) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // ignore quota / privacy-mode errors; persistence is best-effort
    }
  }, [draft]);

  const validation = useMemo(() => {
    if (!draft) return { ok: false as const, issues: [] as string[] };
    const result = SetupZ.safeParse(draft);
    return result.success
      ? ({ ok: true } as const)
      : ({
          ok: false as const,
          issues: result.error.issues.map(
            (i) => `${i.path.join('.') || '(form)'}: ${i.message}`,
          ),
        } as const);
  }, [draft]);

  async function onRun() {
    if (!draft) return;
    const parsed = SetupZ.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await createRun({
        // Manager first, then workers — the engine treats this order as the
        // deterministic worker iteration order for the manager phase.
        avatars: [parsed.data.manager, ...parsed.data.workers],
        target_paper: parsed.data.target_paper,
        rounds_total: parsed.data.rounds_total,
        model: parsed.data.model,
        temperature: parsed.data.temperature,
      });
      router.push(`/runs/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run');
      setSubmitting(false);
    }
  }

  if (!draft) {
    return <div className="text-sm text-gray-500">Loading…</div>;
  }

  return (
    <>
      <h1 className="text-2xl font-semibold mb-6">New run</h1>

      {/* Manager block — exactly one. */}
      <div className="mb-6">
        <AvatarForm
          role="manager"
          value={draft.manager}
          onChange={(next) =>
            setDraft({ ...draft, manager: { ...next, role_in_sim: 'manager' } })
          }
        />
      </div>

      {/* Workers block — N≥1, add/remove. */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3">Workers</h2>
        <WorkersListEditor
          workers={draft.workers}
          onChange={(next) => setDraft({ ...draft, workers: next })}
        />
      </section>

      <section className="bg-white border rounded p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <label className="block">
          <span className="label">Target paper</span>
          <input
            type="number"
            className="input"
            min={1}
            step={1}
            value={draft.target_paper}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              setDraft({ ...draft, target_paper: Number.isFinite(n) ? Math.trunc(n) : 0 });
            }}
          />
        </label>
        <label className="block">
          <span className="label">Rounds</span>
          <input
            type="number"
            className="input"
            min={1}
            max={100}
            step={1}
            value={draft.rounds_total}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              setDraft({ ...draft, rounds_total: Number.isFinite(n) ? Math.trunc(n) : 0 });
            }}
          />
        </label>
        <label className="block">
          <span className="label">Model</span>
          <select
            className="input"
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Temperature</span>
          <input
            type="number"
            className="input"
            min={0}
            max={2}
            step={0.1}
            value={draft.temperature}
            onChange={(e) => {
              const n = e.target.valueAsNumber;
              setDraft({ ...draft, temperature: Number.isFinite(n) ? n : 0 });
            }}
          />
        </label>
      </section>

      {!validation.ok && validation.issues.length > 0 && (
        <ul className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 list-disc list-inside">
          {validation.issues.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onRun}
          disabled={submitting || !validation.ok}
        >
          {submitting ? 'Starting…' : 'Run'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setDraft(defaultDraft())}
          disabled={submitting}
        >
          Reset to defaults
        </button>
      </div>
    </>
  );
}
