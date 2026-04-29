// Fabrication helpers shared by every scenario builder and by the live-tick
// path in the store. Given a run's avatar roster + the round_index to add,
// produce a `DashboardRound` (per-avatar morale + paper_sold for the
// dashboard) plus the matching `DrilldownInteraction[]` and per-avatar
// `DrilldownRoundEntry`s for the drilldown endpoint.
//
// Realism budget:
// - Names + personalities come from the scenario builders (which lift from
//   PRESETS), not from here.
// - Morale walks ±0..6 per round around the previous value, clamped to 30..90.
// - paper_sold = round(baseline_output * morale / 50).
// - Interaction morale_delta is a small signed step (-3..+3) per interaction;
//   per-round end morale is the prior morale plus the sum of round deltas.
// - Messages are short Office-flavored strings drawn from a small pool keyed
//   by situation_tag. They're meant to be readable, not perfect.

import type {
  AvatarProfile,
  DashboardRound,
  DashboardRoundAvatar,
  DrilldownInteraction,
  DrilldownRoundEntry,
  SituationTagId,
} from '@work-sim/shared';
import { SITUATION_TAGS, pickTag } from '@work-sim/shared';

/** Bound a morale reading to a believable mid-range. */
function clampMorale(n: number): number {
  return Math.max(30, Math.min(90, Math.round(n)));
}

/**
 * Tiny deterministic PRNG keyed off (avatarId, roundIndex). Same inputs →
 * same output, so re-running the same scenario builder twice produces
 * identical data. Borrowed shape from packages/shared/src/situation-tags.ts.
 */
function rand(seedStr: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  }
  h >>>= 0;
  let a = (h + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const MANAGER_LINES: Record<SituationTagId, string[]> = {
  routine_check_in: [
    'Hey, just checking in — how are things going on your end?',
    "Got a minute? Want to see how this week's been treating you.",
    'Just a quick pulse check. Anything I should know about?',
  ],
  missed_target: [
    "We didn't hit the number this week. I want to understand what happened.",
    "I saw the totals. Walk me through what's going on.",
    "Numbers are off. Talk to me — where did we lose ground?",
  ],
  big_client_won: [
    'Huge news on the new client. I wanted to celebrate with you specifically.',
    "We landed it. Real momentum — what's that mean for your pipeline?",
    'The big one came through. How are you feeling about the run?',
  ],
  tight_deadline: [
    'EOD deadline is real. What do you need from me to clear the path?',
    'Tight one today. Where are you at?',
    "Clock's ticking. Tell me what's blocking you and I'll handle it.",
  ],
  peer_conflict: [
    "I've heard there's some friction. I'd like to hear your side.",
    'Want to talk through what’s going on with the team?',
    "Something off with you and the team this week. What's up?",
  ],
  quiet_week: [
    'Slow week. Want to use the time to talk longer-term?',
    'Things are quiet. How are you doing — really?',
    "Light week. Anything you've been wanting to bring up?",
  ],
  customer_complaint: [
    'Heard about the escalation. How did you handle it?',
    'Customer thing yesterday — talk me through it.',
    'I want to hear the story on the complaint, from you.',
  ],
  recognition_opportunity: [
    'I noticed what you did. I wanted to say it directly.',
    'That move with the client did not go unnoticed. Nice.',
    'Wanted to flag — saw what you pulled off. Real work.',
  ],
};

const WORKER_LINES: Record<SituationTagId, string[]> = {
  routine_check_in: [
    "It's been fine, honestly. Nothing exploding.",
    "Steady. I'll let you know if that changes.",
    'Pretty normal. Plugging along.',
  ],
  missed_target: [
    'Pipeline ran thin. I take that.',
    "A couple of deals slid into next week. I'll claw it back.",
    'Bad timing on two big calls. Not making excuses.',
  ],
  big_client_won: [
    'Feels good. Already poking at the upsell.',
    'Honestly nice to land one. Energy is up.',
    'Took the team to get there. Glad it landed.',
  ],
  tight_deadline: [
    "I'm on it. Two things in flight; I'll have them to you by 5.",
    "Heads-down. Don't need anything yet.",
    "Tight but doable. I'll flag if it slips.",
  ],
  peer_conflict: [
    "It's not a thing. We worked it out.",
    "I'll be honest, it's been getting under my skin.",
    "I've been trying to stay out of it.",
  ],
  quiet_week: [
    "Yeah, slow. I've been catching up on follow-ups.",
    'Using the lull to clean up the pipeline.',
    'Honestly kind of a relief.',
  ],
  customer_complaint: [
    'Took the call, listened, owned the part that was on us.',
    "Resolved it. They're fine now. I'll log the details.",
    'Tough call, but I think we kept the account.',
  ],
  recognition_opportunity: [
    'Appreciate that. Means something coming from you.',
    'Thanks. Was a good week for it.',
    "Good of you to say. I'll pass it on to the team.",
  ],
};

const PEER_LINES: string[] = [
  'You good? You looked off in the standup.',
  'Got a sec? Want your read on something.',
  "I'm grabbing coffee — coming?",
  'Have you talked to the boss about it yet?',
  "Heads up — I think the manager's in a mood today.",
];

const PEER_REPLIES: string[] = [
  'Yeah. Just one of those days.',
  "Always. What's up?",
  'In a minute — finishing this email.',
  'Not yet. Was waiting to see how this week went.',
  'Noted. Thanks.',
];

function pickLine(pool: string[], seedStr: string): string {
  const r = rand(seedStr);
  return pool[Math.floor(r * pool.length)] ?? pool[0]!;
}

/** Default starting morale per worker. */
export const STARTING_MORALE = 60;

/**
 * Compute paper_sold = round(baseline_output * morale / 50). Worker only;
 * managers always return null at the call site.
 */
export function paperFor(profile: AvatarProfile, morale: number): number {
  return Math.round((profile.baseline_output * morale) / 50);
}

/** Pick a small signed delta in [-3, +3], biased slightly by tag flavor. */
function pickDelta(seedStr: string, tag: SituationTagId): number {
  const r = rand(seedStr);
  const base = Math.round((r - 0.5) * 6); // -3..+3
  // Small per-tag bias.
  const bias =
    tag === 'recognition_opportunity' || tag === 'big_client_won'
      ? 1
      : tag === 'missed_target' || tag === 'customer_complaint' || tag === 'peer_conflict'
        ? -1
        : 0;
  return Math.max(-5, Math.min(5, base + bias));
}

/**
 * Build the situation_tag for a given (seed, roundIndex). Thin wrapper
 * around the shared picker.
 */
export function situationTagFor(seed: number, roundIndex: number): SituationTagId {
  return pickTag(seed, roundIndex);
}

export interface FabricateRoundArgs {
  /** 1-based round index. */
  roundIndex: number;
  /** Per-worker morale at the *start* of this round. */
  prevMorale: Record<string, number>;
  /**
   * All avatar profiles in the run, in deterministic order (manager first).
   * Profiles MUST include the run-scoped `id` field — the drilldown wire
   * shape embeds id+name+role on each interaction's initiator/responder.
   */
  avatars: AvatarProfile[];
  /** Run's situation_tag_seed equivalent. */
  seed: number;
  /** Epoch ms anchor; per-row created_at increments slightly off this. */
  createdAtBase: number;
  /** Whether to also emit one peer interaction. Most rounds: yes. */
  includePeer?: boolean;
}

export interface FabricatedRound {
  dashboardRound: DashboardRound;
  /** All interactions emitted during this round. */
  interactions: DrilldownInteraction[];
  /** Subject-view per-round entries, keyed by avatar_id. One per avatar. */
  roundEntries: Record<string, DrilldownRoundEntry>;
  /** Updated per-worker morale after this round. */
  endMorale: Record<string, number>;
  /** Sum of paper_sold for this round. */
  paperThisRound: number;
}

/**
 * Fabricate one round's worth of data: dashboard summary + drilldown details.
 * Used by both the seed scenario builders and by the store's tickIfRunning
 * path.
 */
export function fabricateRound(args: FabricateRoundArgs): FabricatedRound {
  const { roundIndex, prevMorale, avatars, seed, createdAtBase } = args;
  const includePeer = args.includePeer ?? true;
  const tag = situationTagFor(seed, roundIndex);
  void SITUATION_TAGS; // keep import live for future tag lookups

  const manager = avatars.find((a) => a.role_in_sim === 'manager');
  const workers = avatars.filter((a) => a.role_in_sim === 'worker');
  if (!manager) {
    throw new Error('fabricateRound: no manager avatar in roster');
  }

  // Track per-interaction morale deltas so the round-end morale equals the
  // sum of deltas for that worker.
  const moraleNow: Record<string, number> = { ...prevMorale };
  const interactions: DrilldownInteraction[] = [];

  // Manager↔worker phase. order_in_round 0..workers-1.
  workers.forEach((worker, idx) => {
    const delta = pickDelta(`${worker.id}:${roundIndex}:mgr`, tag);
    moraleNow[worker.id] = clampMorale((moraleNow[worker.id] ?? STARTING_MORALE) + delta);

    interactions.push({
      id: `int-${roundIndex}-mgr-${worker.id}`,
      round_index: roundIndex,
      order_in_round: idx,
      situation_tag: tag,

      initiator: { id: manager.id, name: manager.name, role_in_sim: manager.role_in_sim },
      responder: { id: worker.id, name: worker.name, role_in_sim: worker.role_in_sim },

      initiator_message: pickLine(
        MANAGER_LINES[tag],
        `${manager.id}:${worker.id}:${roundIndex}:m`,
      ),
      responder_message: pickLine(
        WORKER_LINES[tag],
        `${worker.id}:${manager.id}:${roundIndex}:w`,
      ),

      // Manager has no morale in v1.
      initiator_morale_delta: null,
      initiator_morale_rationale: null,

      responder_morale_delta: delta,
      responder_morale_rationale: `Reacted to ${tag.replace(/_/g, ' ')} during the 1:1 with ${manager.name}.`,

      created_at: createdAtBase + 10 + idx,
    });
  });

  // Optional peer phase: one worker↔worker convo per round (when ≥2 workers).
  if (includePeer && workers.length >= 2) {
    const r = rand(`peer:${seed}:${roundIndex}`);
    const i0 = Math.floor(r * workers.length);
    const i1 = (i0 + 1) % workers.length;
    const initiator = workers[i0]!;
    const responder = workers[i1]!;

    const initiatorDelta = pickDelta(`${initiator.id}:${roundIndex}:peer-i`, tag);
    const responderDelta = pickDelta(`${responder.id}:${roundIndex}:peer-r`, tag);
    moraleNow[initiator.id] = clampMorale((moraleNow[initiator.id] ?? STARTING_MORALE) + initiatorDelta);
    moraleNow[responder.id] = clampMorale((moraleNow[responder.id] ?? STARTING_MORALE) + responderDelta);

    interactions.push({
      id: `int-${roundIndex}-peer-${initiator.id}-${responder.id}`,
      round_index: roundIndex,
      order_in_round: workers.length, // strictly after manager phase
      situation_tag: tag,

      initiator: { id: initiator.id, name: initiator.name, role_in_sim: initiator.role_in_sim },
      responder: { id: responder.id, name: responder.name, role_in_sim: responder.role_in_sim },

      initiator_message: pickLine(PEER_LINES, `peer:${initiator.id}:${roundIndex}`),
      responder_message: pickLine(PEER_REPLIES, `peer:${responder.id}:${roundIndex}`),

      initiator_morale_delta: initiatorDelta,
      initiator_morale_rationale: 'Quick check-in with a teammate.',

      responder_morale_delta: responderDelta,
      responder_morale_rationale: 'Took the question at face value.',

      created_at: createdAtBase + 20 + workers.length,
    });
  }

  // Build the per-avatar round summaries.
  const dashboardAvatars: DashboardRoundAvatar[] = [];
  const roundEntries: Record<string, DrilldownRoundEntry> = {};
  let paperThisRound = 0;

  // Manager: null morale + null paper.
  dashboardAvatars.push({ avatar_id: manager.id, morale: null, paper_sold: null });
  roundEntries[manager.id] = {
    round_index: roundIndex,
    situation_tag: tag,
    morale: null,
    morale_rationale: null,
    self_perception: null,
    paper_sold: null,
  };

  for (const worker of workers) {
    const morale = moraleNow[worker.id] ?? STARTING_MORALE;
    const paper = paperFor(worker, morale);
    paperThisRound += paper;

    dashboardAvatars.push({ avatar_id: worker.id, morale, paper_sold: paper });
    roundEntries[worker.id] = {
      round_index: roundIndex,
      situation_tag: tag,
      morale,
      morale_rationale: `Reacted to ${tag.replace(/_/g, ' ')} during the 1:1 with ${manager.name}.`,
      self_perception: 'Holding steady.',
      paper_sold: paper,
    };
  }

  const dashboardRound: DashboardRound = {
    round_index: roundIndex,
    situation_tag: tag,
    created_at: createdAtBase,
    avatars: dashboardAvatars,
  };

  return {
    dashboardRound,
    interactions,
    roundEntries,
    endMorale: moraleNow,
    paperThisRound,
  };
}
