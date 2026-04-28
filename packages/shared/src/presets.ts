// Hand-authored Office-themed agent profiles. Static module — NOT in the
// database. Each run's POST body either uses these values verbatim or edits
// them in the form first; either way, the values are snapshotted into
// `runs.config_json.agents[]` so editing this file later cannot contaminate
// past runs.
//
// See docs/initial-prototype/presets.md for character rationale and pairing
// guidance.

import type { AgentRole } from './types.js';

/**
 * One pre-baked agent profile. `key` is a stable identifier used by the form
 * dropdown; `display_name` is the label shown to the user. The remaining
 * fields are the same shape as `AgentProfile` and get copied into `config_json`
 * verbatim when the user picks the preset.
 */
export interface AgentPreset {
  key: string;
  display_name: string;
  role_in_sim: AgentRole;
  name: string;
  role_label: string;
  personality: string;
  values: string;
  baseline_output: number;
}

/**
 * The full preset list. Ordering here is the order shown in the UI dropdown.
 *
 * To add a preset: append an entry; the dropdown auto-includes it. No DB
 * migration, no API change.
 */
export const PRESETS: readonly AgentPreset[] = [
  // ── Manager presets ──────────────────────────────────────────────────────
  // Each manager has baseline_output: 0 because v1 doesn't compute manager
  // output (locked-decisions.md #6); the column exists so the schema is
  // symmetric for the future bidirectional case.

  // TODO: copy the full personality/values strings from
  //       docs/initial-prototype/presets.md when populating.
  {
    key: 'michael-scott',
    display_name: 'Michael Scott',
    role_in_sim: 'manager',
    name: 'Michael Scott',
    role_label: 'Regional Manager',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 0,
  },
  {
    key: 'jan-levinson',
    display_name: 'Jan Levinson',
    role_in_sim: 'manager',
    name: 'Jan Levinson',
    role_label: 'VP of Northeast Sales',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 0,
  },
  {
    key: 'david-wallace',
    display_name: 'David Wallace',
    role_in_sim: 'manager',
    name: 'David Wallace',
    role_label: 'CFO',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 0,
  },
  {
    key: 'toby-flenderson',
    display_name: 'Toby Flenderson',
    role_in_sim: 'manager',
    name: 'Toby Flenderson',
    role_label: 'Acting Manager (HR background)',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 0,
  },

  // ── Worker presets ───────────────────────────────────────────────────────
  // baseline_output values come from presets.md; tuned to give a meaningful
  // spread across the morale × baseline → paper formula.

  {
    key: 'jim-halpert',
    display_name: 'Jim Halpert',
    role_in_sim: 'worker',
    name: 'Jim Halpert',
    role_label: 'Sales Representative',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 14,
  },
  {
    key: 'pam-beesly',
    display_name: 'Pam Beesly',
    role_in_sim: 'worker',
    name: 'Pam Beesly',
    role_label: 'Receptionist / Sales Support',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 9,
  },
  {
    key: 'dwight-schrute',
    display_name: 'Dwight Schrute',
    role_in_sim: 'worker',
    name: 'Dwight Schrute',
    role_label: 'Top Salesman / Assistant (to the) Regional Manager',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 18,
  },
  {
    key: 'stanley-hudson',
    display_name: 'Stanley Hudson',
    role_in_sim: 'worker',
    name: 'Stanley Hudson',
    role_label: 'Sales Representative',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 12,
  },
  {
    key: 'andy-bernard',
    display_name: 'Andy Bernard',
    role_in_sim: 'worker',
    name: 'Andy Bernard',
    role_label: 'Sales Representative',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 10,
  },
  {
    key: 'phyllis-vance',
    display_name: 'Phyllis Vance',
    role_in_sim: 'worker',
    name: 'Phyllis Vance',
    role_label: 'Sales Representative',
    personality: '', // TODO
    values: '',      // TODO
    baseline_output: 11,
  },
] as const;

/**
 * Pre-grouped views for the setup form: the manager dropdown shows manager
 * presets only, worker dropdown shows worker presets only.
 */
export const PRESETS_BY_ROLE: Record<AgentRole, readonly AgentPreset[]> = {
  manager: PRESETS.filter((p) => p.role_in_sim === 'manager'),
  worker: PRESETS.filter((p) => p.role_in_sim === 'worker'),
};

/** Lookup by stable key. Returns undefined if not found. */
export function getPreset(key: string): AgentPreset | undefined {
  return PRESETS.find((p) => p.key === key);
}
