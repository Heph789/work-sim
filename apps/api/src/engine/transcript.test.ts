import { describe, expect, it } from 'vitest';

import type { AvatarRow, InteractionRow } from '../db/schema.js';
import {
  formatPairHistory,
  formatTodaySoFar,
  formatTranscript,
} from './transcript.js';

function avatar(id: string, name: string): AvatarRow {
  return {
    id,
    runId: 'r',
    roleInSim: 'worker',
    name,
    roleLabel: 'Sales',
    personality: '',
    values: '',
    baselineOutput: 10,
  };
}

function interaction(args: {
  id: string;
  initiatorId: string;
  responderId: string;
  initiatorMessage: string;
  responderMessage: string;
  roundIndex?: number;
  orderInRound?: number;
}): InteractionRow {
  return {
    id: args.id,
    runId: 'r',
    roundId: 'rd',
    roundIndex: args.roundIndex ?? 1,
    orderInRound: args.orderInRound ?? 0,
    situationTag: 'routine_check_in',
    initiatorAvatarId: args.initiatorId,
    responderAvatarId: args.responderId,
    initiatorMessage: args.initiatorMessage,
    responderMessage: args.responderMessage,
    initiatorMorale: null,
    initiatorMoraleRationale: null,
    initiatorSelfPerception: null,
    responderMorale: 50,
    responderMoraleRationale: 'fine',
    responderSelfPerception: 'ok',
    createdAt: 0,
  };
}

describe('formatTranscript', () => {
  it('returns empty string for an empty list', () => {
    expect(
      formatTranscript({
        interactions: [],
        avatarsById: new Map(),
      }),
    ).toBe('');
  });

  it('renders a single interaction as two lines', () => {
    const m = avatar('m', 'Michael');
    const j = avatar('j', 'Jim');
    const out = formatTranscript({
      interactions: [
        interaction({
          id: '1',
          initiatorId: 'm',
          responderId: 'j',
          initiatorMessage: 'hi',
          responderMessage: 'hello',
        }),
      ],
      avatarsById: new Map([
        ['m', m],
        ['j', j],
      ]),
    });
    expect(out).toBe('Michael: hi\nJim: hello');
  });

  it('separates interactions with a blank line', () => {
    const m = avatar('m', 'M');
    const w = avatar('w', 'W');
    const out = formatTranscript({
      interactions: [
        interaction({
          id: '1',
          initiatorId: 'm',
          responderId: 'w',
          initiatorMessage: 'a',
          responderMessage: 'b',
        }),
        interaction({
          id: '2',
          initiatorId: 'm',
          responderId: 'w',
          initiatorMessage: 'c',
          responderMessage: 'd',
        }),
      ],
      avatarsById: new Map([
        ['m', m],
        ['w', w],
      ]),
    });
    expect(out).toBe('M: a\nW: b\n\nM: c\nW: d');
  });
});

describe('formatPairHistory', () => {
  it('keeps only interactions between the two named avatars', () => {
    const a = avatar('a', 'Andy');
    const b = avatar('b', 'Bob');
    const c = avatar('c', 'Cat');
    const out = formatPairHistory({
      interactions: [
        interaction({
          id: '1',
          initiatorId: 'a',
          responderId: 'b',
          initiatorMessage: 'hey',
          responderMessage: 'hi',
        }),
        interaction({
          id: '2',
          initiatorId: 'a',
          responderId: 'c',
          initiatorMessage: 'no',
          responderMessage: 'no',
        }),
        interaction({
          id: '3',
          initiatorId: 'b',
          responderId: 'a',
          initiatorMessage: 'yo',
          responderMessage: 'sup',
        }),
      ],
      avatarA: a,
      avatarB: b,
      avatarsById: new Map([
        ['a', a],
        ['b', b],
        ['c', c],
      ]),
    });
    expect(out).toBe('Andy: hey\nBob: hi\n\nBob: yo\nAndy: sup');
  });
});

describe('formatTodaySoFar', () => {
  it('keeps only interactions where the avatar participated', () => {
    const a = avatar('a', 'A');
    const b = avatar('b', 'B');
    const c = avatar('c', 'C');
    const out = formatTodaySoFar({
      interactionsThisRound: [
        interaction({
          id: '1',
          initiatorId: 'a',
          responderId: 'b',
          initiatorMessage: 'A→B',
          responderMessage: 'B→A',
        }),
        interaction({
          id: '2',
          initiatorId: 'b',
          responderId: 'c',
          initiatorMessage: 'B→C',
          responderMessage: 'C→B',
        }),
      ],
      avatarId: 'a',
      avatarsById: new Map([
        ['a', a],
        ['b', b],
        ['c', c],
      ]),
    });
    expect(out).toBe('A: A→B\nB: B→A');
  });
});
