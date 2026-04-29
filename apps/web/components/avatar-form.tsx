// One avatar panel — used once for the manager and once per worker on the
// setup screen. Renders the preset dropdown + the five form fields. Fully
// controlled: the parent owns the `value`, this component owns no state of
// its own.
//
// Replaces the prior `agent-form.tsx` from the single-worker prototype. Same
// shape, "agent" → "avatar" rename per docs/many-workers/design.md.

'use client';

import type { AvatarProfile, AvatarRole } from '@work-sim/shared';
import { PresetDropdown } from './preset-dropdown';

export interface AvatarFormProps {
  /** Which slot this panel represents. Filters the preset dropdown. */
  role: AvatarRole;
  /** Current form values for this avatar. */
  value: AvatarProfile;
  /** Called whenever any field changes. Parent merges into the run draft. */
  onChange: (next: AvatarProfile) => void;
  /**
   * Optional title override — useful in the workers list where each worker
   * gets a numbered label ("Worker 1", "Worker 2"). Defaults to the role name.
   */
  title?: string;
  /**
   * Optional remove handler. Rendered as an "✕" affordance in the panel's
   * header. Only shown for workers when N>1; never for the manager.
   */
  onRemove?: () => void;
}

const DEFAULT_TITLE: Record<AvatarRole, string> = {
  manager: 'Manager',
  worker: 'Worker',
};

export function AvatarForm({ role, value, onChange, title, onRemove }: AvatarFormProps) {
  const update = <K extends keyof AvatarProfile>(field: K, next: AvatarProfile[K]) =>
    onChange({ ...value, [field]: next });

  // Workers must have ≥1 baseline_output; managers may use 0 (unused in v1).
  const minBaseline = role === 'worker' ? 1 : 0;

  return (
    <section className="bg-white border rounded p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title ?? DEFAULT_TITLE[role]}</h2>
        {onRemove && (
          <button
            type="button"
            className="text-sm text-gray-500 hover:text-red-700"
            onClick={onRemove}
            aria-label="Remove this worker"
          >
            ✕ Remove
          </button>
        )}
      </header>

      <PresetDropdown role={role} currentValue={value} onSelect={onChange} />

      <label className="block">
        <span className="label">Name</span>
        <input
          type="text"
          className="input"
          maxLength={80}
          value={value.name}
          onChange={(e) => update('name', e.target.value)}
        />
      </label>

      <label className="block">
        <span className="label">Role label</span>
        <input
          type="text"
          className="input"
          maxLength={80}
          value={value.role_label}
          onChange={(e) => update('role_label', e.target.value)}
        />
      </label>

      <label className="block">
        <span className="label">Personality</span>
        <textarea
          className="input min-h-[120px]"
          maxLength={2000}
          value={value.personality}
          onChange={(e) => update('personality', e.target.value)}
        />
      </label>

      <label className="block">
        <span className="label">Values</span>
        <textarea
          className="input min-h-[100px]"
          maxLength={2000}
          value={value.values}
          onChange={(e) => update('values', e.target.value)}
        />
      </label>

      <label className="block">
        <span className="label">
          Baseline output
          <span className="ml-1 text-xs font-normal text-gray-500">
            ({role === 'manager' ? 'unused for managers in v1' : 'paper / round at morale 50'})
          </span>
        </span>
        <input
          type="number"
          className="input w-32"
          min={minBaseline}
          max={100}
          step={1}
          value={value.baseline_output}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            update('baseline_output', Number.isFinite(n) ? Math.trunc(n) : minBaseline);
          }}
        />
      </label>
    </section>
  );
}
