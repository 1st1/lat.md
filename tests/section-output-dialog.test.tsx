// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchViewJson = vi.hoisted(() => vi.fn());
const richRenderer = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../view/src/data-source.js', () => ({ fetchViewJson }));
vi.mock('../view/src/markdown-rich-fences.js', () => ({
  renderMarkdownRichFences: richRenderer,
}));

import { SectionOutputDialog } from '../view/src/SectionOutputDialog.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('SectionOutputDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchViewJson.mockReset();
    richRenderer.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('defaults to formatted Markdown and can switch to raw output', async () => {
    fetchViewJson.mockResolvedValue({
      output: '## Raw output',
      html: '<h2 id="raw-output">Formatted output</h2>',
      isError: false,
    });

    await act(async () => {
      root.render(
        createElement(SectionOutputDialog, {
          onClose: vi.fn(),
          sectionId: 'lat.md/guide#Guide',
        }),
      );
    });

    const presentationButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.section-output-presentation button',
      ),
    );
    expect(presentationButtons.map((button) => button.textContent)).toEqual([
      'raw',
      'formatted',
    ]);
    expect(presentationButtons[1].getAttribute('aria-pressed')).toBe('true');
    expect(
      container.querySelector('.section-output-formatted h2')?.textContent,
    ).toBe('Formatted output');
    expect(container.querySelector('.section-output-raw')).toBeNull();

    await act(async () => presentationButtons[0].click());
    expect(container.querySelector('.section-output-raw')?.textContent).toBe(
      '## Raw output',
    );
    expect(container.querySelector('.section-output-formatted')).toBeNull();
  });
});
