import { describe, expect, it } from 'vitest';
import { readOpenCodePluginTemplate } from '../src/cli/gen.js';

describe('gen', () => {
  // @lat: [[tests/gen#OpenCode plugin template uses event hook]]
  it('renders the OpenCode plugin template with a session idle event handler', () => {
    const template = readOpenCodePluginTemplate();
    expect(template).toContain('event: async ({ event }) => {');
    expect(template).toContain("event.type !== 'session.idle'");
  });

  // @lat: [[tests/gen#OpenCode plugin template pipes child process output]]
  it('renders the OpenCode plugin template with piped child stdio', () => {
    const template = readOpenCodePluginTemplate();
    expect(template).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });
});
