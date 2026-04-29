// "Load preset" dropdown above each avatar form. Lists the manager presets in
// the manager panel and worker presets in the worker panel.
//
// Behavior:
// - Default selection mirrors the current form values: if `value` exactly
//   matches one of the presets, that preset's key is selected; otherwise the
//   dropdown shows "(custom)".
// - Picking a preset calls `onSelect(preset)` with the full AvatarProfile-shaped
//   subset → AvatarForm copies all fields onto the form via its `onChange`.

'use client';

import type { AvatarProfile, AvatarPreset, AvatarRole } from '@work-sim/shared';
import { PRESETS } from '@work-sim/shared';

/** Form-side avatar shape: same as AvatarProfile minus the id (server-generated). */
export type AvatarDraft = Omit<AvatarProfile, 'id'>;

export interface PresetDropdownProps {
  /** Filter the list to manager-only or worker-only presets. */
  role: AvatarRole;
  /** Current form value. Used to detect "(custom)" vs a matching preset. */
  currentValue: AvatarDraft;
  /** Called when the user picks a preset (not when "(custom)" is shown). */
  onSelect: (preset: AvatarDraft) => void;
}

const CUSTOM_VALUE = '__custom__';

/** Strip the preset wrapper fields (key, display_name) → form-side AvatarDraft. */
export function presetToProfile(preset: AvatarPreset): AvatarDraft {
  return {
    role_in_sim: preset.role_in_sim,
    name: preset.name,
    role_label: preset.role_label,
    personality: preset.personality,
    values: preset.values,
    baseline_output: preset.baseline_output,
  };
}

/** True when every AvatarDraft field on `value` matches the preset. */
function matchesPreset(value: AvatarDraft, preset: AvatarPreset): boolean {
  return (
    value.role_in_sim === preset.role_in_sim &&
    value.name === preset.name &&
    value.role_label === preset.role_label &&
    value.personality === preset.personality &&
    value.values === preset.values &&
    value.baseline_output === preset.baseline_output
  );
}

export function PresetDropdown({ role, currentValue, onSelect }: PresetDropdownProps) {
  const options = PRESETS.filter((p) => p.role_in_sim === role);
  const matched = options.find((p) => matchesPreset(currentValue, p));
  const selectedKey = matched?.key ?? CUSTOM_VALUE;

  return (
    <label className="block">
      <span className="label">Load preset</span>
      <select
        className="input"
        value={selectedKey}
        onChange={(e) => {
          const key = e.target.value;
          if (key === CUSTOM_VALUE) return;
          const preset = options.find((p) => p.key === key);
          if (preset) onSelect(presetToProfile(preset));
        }}
      >
        <option value={CUSTOM_VALUE}>(custom)</option>
        {options.map((p) => (
          <option key={p.key} value={p.key}>
            {p.display_name}
          </option>
        ))}
      </select>
    </label>
  );
}
