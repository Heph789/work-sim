import { describe, expect, it } from 'vitest';

import {
  paperSold as _paperSold,
  signedDelta,
  teamExpected,
  workerExpectedShare,
} from '../engine/scoring.js';
import {
  toAvatarDetail,
  toRunDetail,
  toRunListItem,
  type AvatarRowLike,
  type InteractionRowLike,
  type RoundAvatarRowLike,
  type RoundRowLike,
  type RunRowLike,
} from './schemas.js';

void _paperSold;

const helpers = { teamExpected, workerExpectedShare, signedDelta };

const baseConfig = {
  avatars: [
    {
      id: 'm',
      role_in_sim: 'manager',
      name: 'Michael',
      role_label: 'Regional Manager',
      personality: '',
      values: '',
      baseline_output: 0,
    },
    {
      id: 'w1',
      role_in_sim: 'worker',
      name: 'Jim',
      role_label: 'Sales Rep',
      personality: '',
      values: '',
      baseline_output: 14,
    },
    {
      id: 'w2',
      role_in_sim: 'worker',
      name: 'Pam',
      role_label: 'Sales Rep',
      personality: '',
      values: '',
      baseline_output: 9,
    },
  ],
  model: 'gpt-4o-mini',
  temperature: 0.8,
  top_p: 1.0,
  prompt_template_version: 'v2',
  situation_tag_seed: 12345,
  sim_engine_version: 'v2',
};

const runRow: RunRowLike = {
  id: 'run-1',
  createdAt: 1000,
  status: 'completed',
  roundsTotal: 4,
  roundsCompleted: 2,
  targetPaper: 100,
  paperTotal: 50,
  experimentId: null,
  configJson: JSON.stringify(baseConfig),
  errorMessage: null,
  failedAtRound: null,
};

const avatarRows: AvatarRowLike[] = [
  {
    id: 'm',
    runId: 'run-1',
    roleInSim: 'manager',
    name: 'Michael',
    roleLabel: 'Regional Manager',
    personality: '',
    values: '',
    baselineOutput: 0,
  },
  {
    id: 'w1',
    runId: 'run-1',
    roleInSim: 'worker',
    name: 'Jim',
    roleLabel: 'Sales Rep',
    personality: '',
    values: '',
    baselineOutput: 14,
  },
  {
    id: 'w2',
    runId: 'run-1',
    roleInSim: 'worker',
    name: 'Pam',
    roleLabel: 'Sales Rep',
    personality: '',
    values: '',
    baselineOutput: 9,
  },
];

const rounds: RoundRowLike[] = [
  { id: 'r1', roundIndex: 1, situationTag: 'routine_check_in', createdAt: 1 },
  { id: 'r2', roundIndex: 2, situationTag: 'tight_deadline', createdAt: 2 },
];

const roundAvatars: RoundAvatarRowLike[] = [
  // Round 1
  {
    roundIndex: 1,
    avatarId: 'm',
    morale: null,
    moraleRationale: null,
    selfPerception: null,
    paperSold: null,
  },
  {
    roundIndex: 1,
    avatarId: 'w1',
    morale: 60,
    moraleRationale: 'good',
    selfPerception: 'sp1',
    paperSold: 17,
  },
  {
    roundIndex: 1,
    avatarId: 'w2',
    morale: 50,
    moraleRationale: 'ok',
    selfPerception: 'sp1',
    paperSold: 9,
  },
  // Round 2
  {
    roundIndex: 2,
    avatarId: 'm',
    morale: null,
    moraleRationale: null,
    selfPerception: null,
    paperSold: null,
  },
  {
    roundIndex: 2,
    avatarId: 'w1',
    morale: 70,
    moraleRationale: 'better',
    selfPerception: 'sp2',
    paperSold: 20,
  },
  {
    roundIndex: 2,
    avatarId: 'w2',
    morale: 40,
    moraleRationale: 'meh',
    selfPerception: 'sp2',
    paperSold: 7,
  },
];

describe('toRunListItem', () => {
  it('exposes the manager name and worker names from config', () => {
    const item = toRunListItem(runRow);
    expect(item.manager_name).toBe('Michael');
    expect(item.worker_names).toEqual(['Jim', 'Pam']);
    expect(item.hit_target).toBe(false);
  });
});

describe('toRunDetail', () => {
  it('strips situation_tag_seed from the public config', () => {
    const detail = toRunDetail({
      run: runRow,
      avatars: avatarRows,
      rounds,
      roundAvatars,
      helpers,
    });
    expect(
      'situation_tag_seed' in (detail.config as Record<string, unknown>),
    ).toBe(false);
  });

  it('aggregates per-avatar morale curves and paper totals', () => {
    const detail = toRunDetail({
      run: runRow,
      avatars: avatarRows,
      rounds,
      roundAvatars,
      helpers,
    });
    const jim = detail.per_avatar.find((p) => p.avatar_id === 'w1')!;
    expect(jim.morale_curve).toEqual([60, 70]);
    expect(jim.paper_per_round).toEqual([17, 20]);
    expect(jim.paper_total).toBe(37);
    expect(jim.last_morale).toBe(70);
    expect(jim.worker_expected_share).toBe(25); // round(100/2 * 2/4) = 25
    expect(jim.worker_delta).toEqual({ abs: 12, direction: 'above' });

    const mgr = detail.per_avatar.find((p) => p.avatar_id === 'm')!;
    expect(mgr.paper_total).toBeNull();
    expect(mgr.worker_expected_share).toBeNull();
    expect(mgr.morale_curve).toEqual([null, null]);
    expect(mgr.last_morale).toBeNull();
  });

  it('groups roundAvatars by round_index in order', () => {
    const detail = toRunDetail({
      run: runRow,
      avatars: avatarRows,
      rounds,
      roundAvatars,
      helpers,
    });
    expect(detail.rounds.map((r) => r.round_index)).toEqual([1, 2]);
    expect(detail.rounds[0]!.situation_tag).toBe('routine_check_in');
    expect(detail.rounds[0]!.avatars).toHaveLength(3);
  });
});

describe('toAvatarDetail', () => {
  const subject: AvatarRowLike = avatarRows[1]!; // Jim
  const partner: AvatarRowLike = avatarRows[2]!; // Pam

  const subjectRoundAvatars: RoundAvatarRowLike[] = [
    {
      roundIndex: 1,
      avatarId: 'w1',
      morale: 60,
      moraleRationale: 'good',
      selfPerception: 'sp1',
      paperSold: 17,
    },
    {
      roundIndex: 2,
      avatarId: 'w1',
      morale: 70,
      moraleRationale: 'better',
      selfPerception: 'sp2',
      paperSold: 20,
    },
  ];

  const interactions: InteractionRowLike[] = [
    {
      id: 'i1',
      roundIndex: 1,
      orderInRound: 0,
      situationTag: 'routine_check_in',
      initiatorAvatarId: 'm',
      responderAvatarId: 'w1',
      initiatorMessage: 'how are sales',
      responderMessage: 'fine',
      initiatorMoraleDelta: null,
      initiatorMoraleRationale: null,
      responderMoraleDelta: 5,
      responderMoraleRationale: 'good',
      createdAt: 1,
    },
  ];

  const avatarsById = new Map<string, AvatarRowLike>(
    avatarRows.map((a) => [a.id, a]),
  );

  it('attaches situation_tag from the rounds map', () => {
    const detail = toAvatarDetail({
      subject,
      partner: null,
      subjectRoundAvatars,
      interactions,
      avatarsById,
      rounds,
    });
    expect(detail.rounds[0]!.situation_tag).toBe('routine_check_in');
    expect(detail.rounds[1]!.situation_tag).toBe('tight_deadline');
  });

  it('exposes subject self_perception via rounds entries', () => {
    const detail = toAvatarDetail({
      subject,
      partner: null,
      subjectRoundAvatars,
      interactions,
      avatarsById,
      rounds,
    });
    expect(detail.rounds[0]!.self_perception).toBe('sp1');
  });

  it('does not include self_perception fields on the interaction shape', () => {
    const detail = toAvatarDetail({
      subject,
      partner,
      subjectRoundAvatars,
      interactions,
      avatarsById,
      rounds,
    });
    const it0 = detail.interactions[0]! as Record<string, unknown>;
    expect('initiator_self_perception' in it0).toBe(false);
    expect('responder_self_perception' in it0).toBe(false);
  });

  it('embeds partner profile when partner is provided', () => {
    const detail = toAvatarDetail({
      subject,
      partner,
      subjectRoundAvatars,
      interactions,
      avatarsById,
      rounds,
    });
    expect(detail.partner?.id).toBe('w2');
    expect(detail.partner?.name).toBe('Pam');
  });
});
