// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const richRenderer = vi.hoisted(() =>
  vi.fn<(root: ParentNode) => Promise<void>>(),
);

vi.mock('../view/src/markdown-rich-fences.js', () => ({
  renderMarkdownRichFences: richRenderer,
}));

import { MarkdownContent } from '../view/src/MarkdownContent.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('MarkdownContent', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    richRenderer.mockReset();
    richRenderer.mockImplementation(async (markdown) => {
      for (const source of markdown.querySelectorAll(
        '.markdown-diagram-source',
      )) {
        const diagram = document.createElement('figure');
        diagram.className = 'rendered-rich-fence';
        source.replaceWith(diagram);
      }
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  // @lat: [[lat.md/view/specs#View Tests#Stabilizes fragment navigation immediately#Preserves rich renderers]]
  it('preserves enhanced DOM when only navigation state rerenders', async () => {
    const html = [
      '<pre class="markdown-diagram-source markdown-mermaid-source">graph</pre>',
      '<pre class="markdown-diagram-source markdown-geojson-source">map</pre>',
    ].join('');

    await act(async () => {
      root.render(createElement(MarkdownContent, { html, onClick: vi.fn() }));
    });
    const rendered = Array.from(
      container.querySelectorAll('.rendered-rich-fence'),
    );
    expect(rendered).toHaveLength(2);
    expect(container.querySelector('.markdown-diagram-source')).toBeNull();

    await act(async () => {
      root.render(createElement(MarkdownContent, { html, onClick: vi.fn() }));
    });
    expect(
      Array.from(container.querySelectorAll('.rendered-rich-fence')),
    ).toEqual(rendered);
    expect(container.querySelector('.markdown-diagram-source')).toBeNull();
    expect(richRenderer).toHaveBeenCalledTimes(1);
  });
});
