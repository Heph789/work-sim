// Editor for the worker list on the setup screen. Renders one AvatarForm per
// worker and an "Add worker" button. Owns no state of its own — fully
// controlled by the parent.
//
// Behavior:
// - "Add worker" appends a new worker seeded from the first available worker
//   preset (or a blank profile if all have been used). Cap left informal —
//   N is bounded by the API's create-run schema, not by the UI.
// - "Remove" on a worker row deletes that row from the list. Disabled when
//   N=1 (the simulation requires at least one worker per design.md §1).
// - Workers are numbered "Worker 1", "Worker 2", … to give the user a visual
//   anchor when several rows are open.

'use client';

import { PRESETS_BY_ROLE } from '@work-sim/shared';
import { AvatarForm } from './avatar-form';
import { presetToProfile, type AvatarDraft } from './preset-dropdown';

export interface WorkersListEditorProps {
  /** Current worker profiles. Order is the deterministic worker iteration order. */
  workers: AvatarDraft[];
  /** Called whenever any worker is edited / added / removed. */
  onChange: (next: AvatarDraft[]) => void;
}

/**
 * Construct a new worker profile to append. Picks the first worker preset
 * not already in `existing` so each "Add" button click yields a different
 * person; falls back to the first preset (then to a blank profile) once
 * we've cycled.
 */
function nextWorker(existing: AvatarDraft[]): AvatarDraft {
  const workerPresets = PRESETS_BY_ROLE.worker;
  const usedNames = new Set(existing.map((w) => w.name));
  const fresh = workerPresets.find((p) => !usedNames.has(p.name));
  if (fresh) return presetToProfile(fresh);
  if (workerPresets.length > 0) return presetToProfile(workerPresets[0]!);
  // No presets available — return an empty worker. The form's required
  // validators will surface the empty fields to the user.
  return {
    role_in_sim: 'worker',
    name: '',
    role_label: '',
    personality: '',
    values: '',
    baseline_output: 1,
  };
}

export function WorkersListEditor({ workers, onChange }: WorkersListEditorProps) {
  const setAt = (index: number, value: AvatarDraft) => {
    const next = workers.slice();
    next[index] = { ...value, role_in_sim: 'worker' };
    onChange(next);
  };

  const removeAt = (index: number) => {
    if (workers.length <= 1) return;
    const next = workers.slice();
    next.splice(index, 1);
    onChange(next);
  };

  const add = () => {
    onChange([...workers, nextWorker(workers)]);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {workers.map((w, i) => (
          <AvatarForm
            key={i}
            role="worker"
            title={`Worker ${i + 1}`}
            value={w}
            onChange={(next) => setAt(i, next)}
            onRemove={workers.length > 1 ? () => removeAt(i) : undefined}
          />
        ))}
      </div>
      <div>
        <button type="button" className="btn-secondary" onClick={add}>
          + Add worker
        </button>
      </div>
    </div>
  );
}
