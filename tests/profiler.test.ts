import { describe, expect, it } from 'vitest';
import { TimingProfiler } from '../src/profiler.js';

describe('TimingProfiler', () => {
  // @lat: [[tests/check-headless#Keeps concurrent profile scopes separate]]
  it('attributes nested work to the correct concurrent parent', async () => {
    const profiler = new TimingProfiler();
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = profiler.time('first', async () => {
      await firstCanFinish;
      profiler.timeSync('first child', () => undefined);
    });
    const second = profiler.time('second', async () => {
      profiler.timeSync('second child', () => undefined);
      releaseFirst();
    });

    await Promise.all([first, second]);

    const report = profiler.format(0).join('\n');
    expect(report).toMatch(/^  first:/m);
    expect(report).toMatch(/^    first child:/m);
    expect(report).toMatch(/^  second:/m);
    expect(report).toMatch(/^    second child:/m);
  });
});
