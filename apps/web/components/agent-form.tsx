// One agent panel — used twice on the setup screen (once for manager, once
// for worker). Renders the preset dropdown + the five form fields. Fully
// controlled: the parent owns the `value`, this component owns no state of
// its own beyond a memoized "is current value === current preset?" check.

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

/**
 * A labeled card with one row per agent field. Selecting a preset overwrites
 * all five fields by calling `onChange` with the preset's values. Editing
 * any field afterward causes the dropdown to display "(custom)" — see
 * PresetDropdown for that detection.
 */
export function AgentForm(props: AgentFormProps) {
  const { role, value, onChange } = props;
  // TODO: render <PresetDropdown role={role} currentValue={value} onSelect={onChange} />
  // TODO: render five inputs:
  //   - Name (text, max 80)
  //   - Role label (text, max 80)
  //   - Personality (textarea, max 2000)
  //   - Values (textarea, max 2000)
  //   - Baseline output (number, integer; allow 0 for managers, ≥1 for workers)
  // Each input dispatches `onChange({ ...value, <field>: nextFieldValue })`.
  void role;
  void value;
  void onChange;
  void PresetDropdown;
  return null;
}
