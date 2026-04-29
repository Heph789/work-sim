// Fabrication helpers shared by every scenario builder and by the live-tick
// path in the store. Given a run's avatar roster + the round_index to add,
// produce a realistic-looking RoundView, the per-avatar RoundAvatarView rows,
// and the InteractionViews (manager↔worker phase first, then optional peer
// phase).
//
// Realism budget:
// - Names + personalities come from the scenario builders (which lift from
//   PRESETS), not from here.
// - Morale walks ±0..8 per round around the previous value, clamped to 30..90.
// - paper_sold = round(baseline_output * morale / 50).
// - Messages are short Office-flavored strings drawn from a small pool keyed
//   by situation_tag. They're meant to be readable, not perfect.

import type {
  AvatarView,
  InteractionView,
  RoundAvatarView,
  RoundView,
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
  // single-step mulberry32
  let a = (h + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * One-line message pool per situation tag. Each role (manager-side vs
 * worker-side) has its own list; we pick deterministically by round +
 * avatar id.
 */
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
    "Tight one today. Where are you at?",
    "Clock's ticking. Tell me what's blocking you and I'll handle it.",
  ],
  peer_conflict: [
    "I've heard there's some friction. I'd like to hear your side.",
    "Want to talk through what's going on with the team?",
    "Something off with you and the team this week. What's up?",
  ],
  quiet_week: [
    "Slow week. Want to use the time to talk longer-term?",
    "Things are quiet. How are you doing — really?",
    "Light week. Anything you've been wanting to bring up?",
  ],
  customer_complaint: [
    "Heard about the escalation. How did you handle it?",
    "Customer thing yesterday — talk me through it.",
    "I want to hear the story on the complaint, from you.",
  ],
  recognition_opportunity: [
    'I noticed what you did. I wanted to say it directly.',
    "That move with the client did not go unnoticed. Nice.",
    "Wanted to flag — saw what you pulled off. Real work.",
  ],
};

const WORKER_LINES: Record<SituationTagId, string[]> = {
  routine_check_in: [
    "It's been fine, honestly. Nothing exploding.",
    "Steady. I'll let you know if that changes.",
    "Pretty normal. Plugging along.",
  ],
  missed_target: [
    "Pipeline ran thin. I take that.",
    "A couple of deals slid into next week. I'll claw it back.",
    "Bad timing on two big calls. Not making excuses.",
  ],
  big_client_won: [
    "Feels good. Already poking at the upsell.",
    "Honestly nice to land one. Energy is up.",
    "Took the team to get there. Glad it landed.",
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
    "Using the lull to clean up the pipeline.",
    "Honestly kind of a relief.",
  ],
  customer_complaint: [
    "Took the call, listened, owned the part that was on us.",
    "Resolved it. They're fine now. I'll log the details.",
    "Tough call, but I think we kept the account.",
  ],
  recognition_opportunity: [
    "Appreciate that. Means something coming from you.",
    "Thanks. Was a good week for it.",
    "Good of you to say. I'll pass it on to the team.",
  ],
};

const PEER_LINES: string[] = [
  'You good? You looked off in the standup.',
  "Got a sec? Want your read on something.",
  "I'm grabbing coffee — coming?",
  "Have you talked to the boss about it yet?",
  "Heads up — I think the manager's in a mood today.",
];

const PEER_REPLIES: string[] = [
  "Yeah. Just one of those days.",
  "Always. What's up?",
  "In a minute — finishing this email.",
  "Not yet. Was waiting to see how this week went.",
  "Noted. Thanks.",
];

function pickLine(pool: string[], seedStr: string): string {
  const r = rand(seedStr);
  return pool[Math.floor(r * pool.length)] ?? pool[0]!;
}

/**
 * Walk a previous morale value to a new one. Drift is small (±0..8) so a
 * morale series across 8–10 rounds looks like a curve, not noise.
 */
export function nextMorale(prev: number, seedStr: string): number {
  const r = rand(seedStr);
  // Roughly centered on 0; range ~ [-6, +6]
  const delta = Math.round((r - 0.5) * 12);
  return clampMorale(prev + delta);
}

/**
 * Default starting morale per worker. 60 puts everyone slightly above the
 * 50-baseline so the first round shows non-trivial paper output.
 */
export const STARTING_MORALE = 60;

/**
 * Compute paper_sold = round(baseline_output * morale / 50). Worker only;
 * managers always return null.
 */
export function paperFor(avatar: AvatarView, morale: number): number {
  return Math.round((avatar.baseline_output * morale) / 50);
}

/**
 * Build the situation_tag for a given (seed, roundIndex). Thin wrapper
 * around the shared picker — exported so the store can compute tags for
 * fabricated rounds with the same RNG the real engine would use.
 */
export function situationTagFor(seed: number, roundIndex: number): SituationTagId {
  return pickTag(seed, roundIndex);
}

export interface FabricateRoundArgs {
  /** 1-based round index. */
  roundIndex: number;
  /** Per-avatar morale at the *start* of this round (i.e. end of prior round). For round 1, callers pass STARTING_MORALE for every worker. */
  prevMorale: Record<string, number>;
  /** All avatars in the run; deterministic order, manager first. */
  avatars: AvatarView[];
  /** Run's situation_tag_seed equivalent. */
  seed: number;
  /** Epoch ms anchor; per-row created_at increments slightly off this. */
  createdAtBase: number;
  /** Whether to also emit one peer interaction. Most rounds: yes. */
  includePeer?: boolean;
}

export interface FabricatedRound {
  round: RoundView;
  roundAvatars: RoundAvatarView[];
  interactions: InteractionView[];
  /** Updated per-worker morale after this round. Caller threads it into the next call. */
  endMorale: Record<string, number>;
  /** Sum of paper_sold for this round. */
  paperThisRound: number;
}

/**
 * Fabricate one round's worth of data for a run. Used by both the seed
 * scenarios (loop 1..N during build) and by the store's tickIfRunning path.
 */
export function fabricateRound(args: FabricateRoundArgs): FabricatedRound {
  const { roundIndex, prevMorale, avatars, seed, createdAtBase } = args;
  const includePeer = args.includePeer ?? true;
  const tag = situationTagFor(seed, roundIndex);
  const tagDescription =
    SITUATION_TAGS.find((t) => t.tag === tag)?.description ?? '';
  void tagDescription; // referenced for clarity; not currently in the wire shape

  const manager = avatars.find((a) => a.role_in_sim === 'manager');
  const workers = avatars.filter((a) => a.role_in_sim === 'worker');
  if (!manager) {
    throw new Error('fabricateRound: no manager avatar in roster');
  }

  const round: RoundView = {
    round_index: roundIndex,
    situation_tag: tag,
    created_at: createdAtBase,
  };

  const endMorale: Record<string, number> = { ...prevMorale };
  const roundAvatars: RoundAvatarView[] = [];
  const interactions: InteractionView[] = [];
  let paperThisRound = 0;

  // Manager row first — managers have null morale/paper in v1.
  roundAvatars.push({
    round_index: roundIndex,
    avatar_id: manager.id,
    morale: null,
    morale_rationale: null,
    self_perception: null,
    paper_sold: null,
    created_at: createdAtBase + 1,
  });

  // Manager↔worker phase. order_in_round 0..workers-1.
  workers.forEach((worker, idx) => {
    const newMorale = nextMorale(
      prevMorale[worker.id] ?? STARTING_MORALE,
      `${worker.id}:${roundIndex}:morale`,
    );
    endMorale[worker.id] = newMorale;
    const paper = paperFor(worker, newMorale);
    paperThisRound += paper;

    roundAvatars.push({
      round_index: roundIndex,
      avatar_id: worker.id,
      morale: newMorale,
      morale_rationale: `Reacted to ${tag.replace(/_/g, ' ')} during the 1:1 with ${manager.name}.`,
      self_perception: `Holding steady.`,
      paper_sold: paper,
      created_at: createdAtBase + 2 + idx,
    });

    interactions.push({
      id: `int-${roundIndex}-mgr-${worker.id}`,
      round_index: roundIndex,
      order_in_round: idx,
      situation_tag: tag,

      initiator_avatar_id: manager.id,
      responder_avatar_id: worker.id,

      initiator_message: pickLine(
        MANAGER_LINES[tag],
        `${manager.id}:${worker.id}:${roundIndex}:m`,
      ),
      responder_message: pickLine(
        WORKER_LINES[tag],
        `${worker.id}:${manager.id}:${roundIndex}:w`,
      ),

      // Manager has no morale in v1.
      initiator_morale: null,
      initiator_morale_rationale: null,
      initiator_self_perception: null,

      responder_morale: newMorale,
      responder_morale_rationale: `Reacted to ${tag.replace(/_/g, ' ')} during the 1:1 with ${manager.name}.`,
      responder_self_perception: `Holding steady.`,

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
    interactions.push({
      id: `int-${roundIndex}-peer-${initiator.id}-${responder.id}`,
      round_index: roundIndex,
      order_in_round: workers.length, // strictly after manager phase
      situation_tag: tag,

      initiator_avatar_id: initiator.id,
      responder_avatar_id: responder.id,

      initiator_message: pickLine(PEER_LINES, `peer:${initiator.id}:${roundIndex}`),
      responder_message: pickLine(PEER_REPLIES, `peer:${responder.id}:${roundIndex}`),

      initiator_morale: endMorale[initiator.id] ?? STARTING_MORALE,
      initiator_morale_rationale: 'Quick check-in with a teammate.',
      initiator_self_perception: 'Trying to read the room.',

      responder_morale: endMorale[responder.id] ?? STARTING_MORALE,
      responder_morale_rationale: 'Took the question at face value.',
      responder_self_perception: 'Going along with it.',

      created_at: createdAtBase + 20 + workers.length,
    });
  }

  return {
    round,
    roundAvatars,
    interactions,
    endMorale,
    paperThisRound,
  };
}
