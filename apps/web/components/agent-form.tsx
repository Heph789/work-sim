// One agent panel — used twice on the setup screen (once for manager, once
// for worker). Renders the preset dropdown + the five form fields. Fully
// controlled: the parent owns the `value`, this component owns no state of
// its own.

'use client';

import type { AgentProfile, AgentRole } from '@work-sim/shared';
import { PresetDropdown } from './preset-dropdown';

export interface AgentFormProps {
  /** Which slot this panel represents. Filters the preset dropdown. */
  role: AgentRole;
  /** Current form values for this agent. */
  value: AgentProfile;
  /** Called whenever any field changes. Parent merges into the run draft. */
  onChange: (next: AgentProfile) => void;
}

const ROLE_TITLE: Record<AgentRole, string> = {
  manager: 'Manager',
  worker: 'Worker',
};

export function AgentForm({ role, value, onChange }: AgentFormProps) {
  const update = <K extends keyof AgentProfile>(field: K, next: AgentProfile[K]) =>
    onChange({ ...value, [field]: next });

  // Workers must have ≥1 baseline_output; managers may use 0 (unused in v1).
  const minBaseline = role === 'worker' ? 1 : 0;

  return (
    <section className="bg-white border rounded p-5 space-y-4">
      <h2 className="text-lg font-semibold">{ROLE_TITLE[role]}</h2>

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
