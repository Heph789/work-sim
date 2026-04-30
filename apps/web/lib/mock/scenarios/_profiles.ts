// Convenience: pre-stripped preset profiles (without role_in_sim) for use in
// scenario builders. The buildRun helper attaches role_in_sim itself.

import { getPreset } from '@work-sim/shared';

function profileOf(key: string) {
  const p = getPreset(key);
  if (!p) throw new Error(`unknown preset key: ${key}`);
  return {
    name: p.name,
    role_label: p.role_label,
    personality: p.personality,
    values: p.values,
    baseline_output: p.baseline_output,
  };
}

export const MICHAEL = profileOf('michael-scott');
export const JAN = profileOf('jan-levinson');
export const DAVID = profileOf('david-wallace');
export const TOBY = profileOf('toby-flenderson');

export const JIM = profileOf('jim-halpert');
export const PAM = profileOf('pam-beesly');
export const DWIGHT = profileOf('dwight-schrute');
export const STANLEY = profileOf('stanley-hudson');
export const ANDY = profileOf('andy-bernard');
export const PHYLLIS = profileOf('phyllis-vance');
