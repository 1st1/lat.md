// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from '../view/src/FileTree.js';
import { fileTreeStorageKey } from '../view/src/file-tree.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('FileTree', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  // @lat: [[lat.md/view/specs#View Tests#Preserves expanded directories]]
  it('keeps visited directories open and restores them from local storage', async () => {
    const storageKey = fileTreeStorageKey(null);
    const renderTree = async (activePath: string) => {
      await act(async () => {
        root.render(
          <FileTree
            activeExternalTarget={null}
            activePath={activePath}
            errorCounts={{}}
            externalFiles={[]}
            files={[
              'lat.md',
              'api/api.md',
              'api/reference.md',
              'guides/guides.md',
              'guides/setup.md',
            ]}
            gitFiles={{}}
            onNavigate={vi.fn()}
            storageKey={storageKey}
          />,
        );
      });
    };

    await renderTree('guides/setup.md');
    let directories = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('.tree-directory'),
    );
    expect(directories.map(({ open }) => open)).toEqual([false, true]);

    await renderTree('api/reference.md');
    directories = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('.tree-directory'),
    );
    expect(directories.map(({ open }) => open)).toEqual([true, true]);
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')).toEqual(
      ['api', 'guides'],
    );

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderTree('lat.md');
    directories = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('.tree-directory'),
    );
    expect(directories.map(({ open }) => open)).toEqual([true, true]);

    await act(async () => {
      directories[0].querySelector('summary')?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(directories.map(({ open }) => open)).toEqual([false, true]);
    expect(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')).toEqual(
      ['guides'],
    );
  });
});
