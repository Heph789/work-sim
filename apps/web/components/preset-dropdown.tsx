// "Load preset" dropdown above each agent form. Lists the manager presets in
// the manager panel and worker presets in the worker panel.
//
// Behavior:
// - Default selection mirrors the current form values: if `value` exactly
//   matches one of the presets, that preset's key is selected; otherwise the
//   dropdown shows "(custom)".
// - Picking a preset calls `onSelect(preset)` with the full AgentPreset →
//   AgentForm copies all fields onto the form via its `onChange`.

'use client';

import type { AgentProfile, AgentPreset, AgentRole } from '@work-sim/shared';
import { PRESETS } from '@work-sim/shared';

export interface PresetDropdownProps {
  /** Filter the list to manager-only or worker-only presets. */
  role: AgentRole;
  /** Current form value. Used to detect "(custom)" vs a matching preset. */
  currentValue: AgentProfile;
  /** Called when the user picks a preset (not when "(custom)" is shown). */
  onSelect: (preset: AgentProfile) => void;
}

/**
 * Render a <select> over presets-of-this-role. Implementation detail: we
 * compare every text field plus baseline_output to detect an exact match.
 * Any divergence → display "(custom)" with no key selected.
 */
export function PresetDropdown(props: PresetDropdownProps) {
  const { role, currentValue, onSelect } = props;
  const options = PRESETS.filter((p) => p.role_in_sim === role);
  // TODO: derive currently-selected key by deep-equal-ing currentValue against each preset's profile fields.
  // TODO: render <select> with options + a leading "(custom)" sentinel.
  // TODO: on change, find the matching preset and call onSelect with its AgentProfile-shaped subset.
  void options;
  void currentValue;
  void onSelect;
  return null;
}

/** Strip the preset wrapper fields (key, display_name) → AgentProfile. */
// TODO: implement presetToProfile(preset: AgentPreset): AgentProfile.
function _presetToProfile(_preset: AgentPreset): AgentProfile {
  // TODO: return { role_in_sim, name, role_label, personality, values, baseline_output }.
  throw new Error('not implemented');
}
void _presetToProfile;
