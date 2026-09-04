import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { checklistMenu } from '../src/cli/checklist-menu.js';

const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')!;
afterEach(() => {
  Object.defineProperty(process, 'stdin', stdinDescriptor);
  vi.restoreAllMocks();
});

// @lat: [[init#Agent preferences#Checklist restores editable defaults]]
it('renders saved known agents checked, allows toggling, and ignores stale values', async () => {
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(),
  });
  Object.defineProperty(process, 'stdin', { configurable: true, value: stdin });
  const output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const options = [
    { label: 'Claude Code', value: 'claude' },
    { label: 'Codex', value: 'codex' },
  ];
  const result = checklistMenu(options, 'Agents?', [
    'codex',
    'removed',
    'codex',
  ]);
  const rendered = output.mock.calls.map(([text]) => String(text)).join('');
  expect(rendered).toMatch(/\[x\].*Codex/);
  expect(rendered).toMatch(/\[ \].*Claude Code/);
  stdin.emit('data', ' ');
  stdin.emit('data', 'j');
  stdin.emit('data', ' ');
  stdin.emit('data', '\r');
  expect(await result).toEqual(['claude']);
  expect(stdin.listenerCount('data')).toBe(0);
  expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);

  stdin.isTTY = false;
  expect(await checklistMenu(options, 'Agents?', ['codex'])).toEqual([]);
  stdin.destroy();
});
