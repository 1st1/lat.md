import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { plainStyler } from '../../src/context.js';

const {
  addCanonicalExternalSource,
  createInterface,
  resolveExternalCommit,
  selectMenu,
} = vi.hoisted(() => ({
  addCanonicalExternalSource: vi.fn(async () => {}),
  createInterface: vi.fn(),
  resolveExternalCommit: vi.fn(),
  selectMenu: vi.fn(),
}));

vi.mock('node:readline/promises', () => ({ createInterface }));
vi.mock('../../src/cli/select-menu.js', () => ({ selectMenu }));
vi.mock('../../src/external-sources.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/external-sources.js')>()),
  addCanonicalExternalSource,
  resolveExternalCommit,
}));

import { externalAddCommand } from '../../src/cli/external.js';

describe('lat external add', () => {
  let stdinIsTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: true,
    });
    addCanonicalExternalSource.mockClear();
    createInterface.mockReset();
    resolveExternalCommit.mockReset();
    selectMenu.mockReset();
  });

  afterEach(() => {
    if (stdinIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY);
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    }
  });

  // @lat: [[tests/external-tests#External Sources#Commands and MCP#Interactive add prompt lifecycle]]
  it('detaches readline while the raw strategy menu owns stdin', async () => {
    const closeBeforeMenu = vi.fn();
    const closeAfterConfirmation = vi.fn();
    const question = vi.fn(async () => '');
    createInterface
      .mockReturnValueOnce({ close: closeBeforeMenu, question: vi.fn() })
      .mockReturnValueOnce({ close: closeAfterConfirmation, question });
    selectMenu.mockImplementation(async () => {
      expect(closeBeforeMenu).toHaveBeenCalledOnce();
      return 'fetch';
    });
    resolveExternalCommit.mockResolvedValue(
      '05447419fbc708fbedaa7bc9740dcd242fab0d08',
    );

    const result = await externalAddCommand(
      {
        latDir: '/project/lat.md',
        projectRoot: '/project',
        styler: plainStyler,
        mode: 'cli',
      },
      'node',
      'https://github.com/nodejs/node',
      { commit: 'main', prefix: '', defaultFileExtension: 'md' },
    );

    expect(result.isError).not.toBe(true);
    expect(selectMenu).toHaveBeenCalledOnce();
    expect(createInterface).toHaveBeenCalledTimes(2);
    expect(question).toHaveBeenCalledWith(
      'Add external source "node" at commit "05447419fbc708fbedaa7bc9740dcd242fab0d08" using "fetch"? [Y/n] ',
    );
    expect(closeAfterConfirmation).toHaveBeenCalledOnce();
    expect(addCanonicalExternalSource).toHaveBeenCalledWith(
      '/project/lat.md',
      expect.objectContaining({
        handle: 'node',
        defaultFileExtension: 'md',
        strategy: 'fetch',
      }),
    );
  });

  it.each([
    ['.md', 'default-file-extension must not start with "."'],
    ['txt', 'unsupported default file extension "txt"; supported extensions:'],
  ])(
    'rejects invalid default extension %s before strategy selection',
    async (extension, message) => {
      const close = vi.fn();
      const question = vi.fn(async () => extension);
      createInterface.mockReturnValue({ close, question });

      const result = await externalAddCommand(
        {
          latDir: '/project/lat.md',
          projectRoot: '/project',
          styler: plainStyler,
          mode: 'cli',
        },
        'node',
        'https://github.com/nodejs/node',
        { commit: 'main', prefix: '' },
      );

      expect(result).toEqual({
        output: expect.stringContaining(message),
        isError: true,
      });
      expect(question).toHaveBeenCalledWith(
        'Default file extension (optional): ',
      );
      expect(selectMenu).not.toHaveBeenCalled();
      expect(resolveExternalCommit).not.toHaveBeenCalled();
      expect(addCanonicalExternalSource).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
    },
  );
});
