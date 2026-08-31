import { describe, expect, it } from 'vitest';
import { mergeProjectChange } from '../view/src/live-updates.js';

describe('live view updates', () => {
  // @lat: [[lat.md/view/specs#View Tests#Updates long-running views incrementally#Accepts restarted server generations]]
  it('accepts lower generations from a new server instance', () => {
    const current = {
      instanceId: 'old-server',
      generation: 42,
      markdownGeneration: 17,
    };

    expect(
      mergeProjectChange(current, {
        instanceId: 'old-server',
        generation: 40,
        markdownGeneration: 15,
      }),
    ).toBe(current);
    expect(
      mergeProjectChange(current, {
        instanceId: 'new-server',
        generation: 0,
        markdownGeneration: 0,
      }),
    ).toEqual({
      instanceId: 'new-server',
      generation: 0,
      markdownGeneration: 0,
    });
  });
});
