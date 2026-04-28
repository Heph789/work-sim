import { describe, expect, it } from 'vitest';

import { formatTranscript } from './transcript.js';

describe('formatTranscript', () => {
  it('returns empty string for no rounds', () => {
    expect(
      formatTranscript({ priorRounds: [], managerName: 'M', workerName: 'W' }),
    ).toBe('');
  });

  it('renders one round as two lines', () => {
    const out = formatTranscript({
      priorRounds: [{ manager_message: 'hi', worker_message: 'hello' }],
      managerName: 'Michael',
      workerName: 'Jim',
    });
    expect(out).toBe('Michael: hi\nJim: hello');
  });

  it('separates rounds with a blank line', () => {
    const out = formatTranscript({
      priorRounds: [
        { manager_message: 'a', worker_message: 'b' },
        { manager_message: 'c', worker_message: 'd' },
      ],
      managerName: 'M',
      workerName: 'W',
    });
    expect(out).toBe('M: a\nW: b\n\nM: c\nW: d');
  });
});
