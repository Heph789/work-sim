import { describe, expect, it } from 'vitest';

import type { AvatarProfile } from '@work-sim/shared';

import type { AvatarRow } from '../db/schema.js';
import {
  buildManagerPrompt,
  buildPeerInitiatorOpeningPrompt,
  buildPeerInitiatorReflectionPrompt,
  buildPeerResponderPrompt,
  buildWorker1on1Prompt,
} from './prompts.js';

function profile(overrides: Partial<AvatarProfile> = {}): AvatarProfile {
  return {
    id: 'p',
    role_in_sim: 'worker',
    name: 'Pat',
    role_label: 'Sales',
    personality: 'busy',
    values: 'fairness',
    baseline_output: 10,
    ...overrides,
  };
}

const managerProfile = profile({
  id: 'm',
  role_in_sim: 'manager',
  name: 'Michael',
  role_label: 'Regional Manager',
  baseline_output: 0,
  personality: 'mgr-personality-secret',
});

const workerProfile = profile({
  id: 'w',
  role_in_sim: 'worker',
  name: 'Jim',
  role_label: 'Sales Rep',
  personality: 'jim-personality-secret',
  values: 'jim-values-secret',
  baseline_output: 17,
});

describe('buildManagerPrompt', () => {
  it('omits worker private fields (morale, self_perception, baseline_output)', () => {
    const messages = buildManagerPrompt({
      manager: managerProfile,
      worker: workerProfile,
      situationTag: 'routine_check_in',
      targetPaper: 100,
      paperTotal: 30,
      teamExpected: 50,
      teamDelta: { abs: 20, direction: 'below' },
      roundsRemaining: 5,
      workerPaperTotal: 12,
      workerExpectedShare: 25,
      workerDelta: { abs: 13, direction: 'below' },
      priorManagerWorkerInteractions: [],
      avatarsById: new Map(),
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).not.toContain('morale');
    expect(text).not.toContain('self_perception');
    expect(text).not.toContain('baseline_output');
    expect(text).not.toContain('jim-personality-secret');
    expect(text).not.toContain('jim-values-secret');
    expect(text).not.toMatch(/baseline/i);
  });

  it('includes objective stats and the worker name', () => {
    const messages = buildManagerPrompt({
      manager: managerProfile,
      worker: workerProfile,
      situationTag: 'routine_check_in',
      targetPaper: 100,
      paperTotal: 30,
      teamExpected: 50,
      teamDelta: { abs: 20, direction: 'below' },
      roundsRemaining: 5,
      workerPaperTotal: 12,
      workerExpectedShare: 25,
      workerDelta: { abs: 13, direction: 'below' },
      priorManagerWorkerInteractions: [],
      avatarsById: new Map(),
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('Jim');
    expect(text).toContain('100 units');
    expect(text).toContain('20 units below');
    expect(text).toContain('13 units below');
  });
});

describe('buildWorker1on1Prompt', () => {
  it('includes the worker self_perception and the manager message and asks for morale_delta', () => {
    const messages = buildWorker1on1Prompt({
      worker: workerProfile,
      manager: managerProfile,
      situationTag: 'routine_check_in',
      selfPerception: 'I feel underused.',
      managerMessage: 'How are sales?',
      todayInteractionsForWorker: [],
      priorManagerWorkerInteractions: [],
      avatarsById: new Map(),
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('I feel underused.');
    expect(text).toContain('How are sales?');
    expect(text).toContain('JSON object');
    expect(text).toContain('morale_delta');
    expect(text).toContain('-10 and +10');
  });

  it('does NOT reveal the worker their current absolute morale', () => {
    const messages = buildWorker1on1Prompt({
      worker: workerProfile,
      manager: managerProfile,
      situationTag: 'routine_check_in',
      selfPerception: 'fine',
      managerMessage: 'hi',
      todayInteractionsForWorker: [],
      priorManagerWorkerInteractions: [],
      avatarsById: new Map(),
    });
    const text = messages.map((m) => m.content).join('\n');
    // The user prompt body should not contain phrases that surface a current
    // 0..100 morale value to the avatar — we only describe the delta range.
    expect(text).not.toMatch(/your current morale/i);
    expect(text).not.toMatch(/morale: \d+/);
  });
});

describe('peer initiator (2-call) and peer responder', () => {
  const peerSelf = profile({ id: 'p1', name: 'Pam' });
  const peerPartner = profile({ id: 'p2', name: 'Andy' });

  it('opening call asks only for a message — no morale, no self_perception update', () => {
    const messages = buildPeerInitiatorOpeningPrompt({
      self: peerSelf,
      partner: peerPartner,
      situationTag: 'routine_check_in',
      selfPerception: 'feeling fine',
      todayInteractionsForSelf: [],
      pairHistory: [],
      avatarsById: new Map(),
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('hallway');
    expect(text).toContain('What do you say?');
    expect(text).not.toContain('morale_delta');
    expect(text).not.toContain('updated_self_perception');
  });

  it('responder framing includes the initiator message and asks for morale_delta', () => {
    const messages = buildPeerResponderPrompt({
      self: peerPartner,
      partner: peerSelf,
      situationTag: 'routine_check_in',
      selfPerception: 'cautious',
      todayInteractionsForSelf: [],
      pairHistory: [],
      initiatorMessage: 'Hey, got a sec?',
      avatarsById: new Map(),
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('Hey, got a sec?');
    expect(text).toContain('Respond now');
    expect(text).toContain('morale_delta');
  });

  it('reflection call shows both the initiating message AND the reply, and asks for delta + perception', () => {
    const messages = buildPeerInitiatorReflectionPrompt({
      self: peerSelf,
      partner: peerPartner,
      situationTag: 'routine_check_in',
      selfPerception: 'feeling fine',
      todayInteractionsForSelf: [],
      pairHistory: [],
      initiatorMessage: 'Hey, got a sec?',
      responderMessage: 'Not really.',
      avatarsById: new Map(),
    });
    const text = messages.map((m) => m.content).join('\n');
    expect(text).toContain('Hey, got a sec?');
    expect(text).toContain('Not really.');
    expect(text).toContain('morale_delta');
    expect(text).toContain('updated_self_perception');
    expect(text).toContain('reflect');
  });
});

// Reference imports so tsc doesn't complain when one of the helpers becomes unused.
void (null as unknown as AvatarRow);
