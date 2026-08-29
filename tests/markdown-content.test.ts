// @vitest-environment jsdom

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
import type { ViewDocumentTree } from '../src/view/protocol.js';

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
    const tree: ViewDocumentTree = {
      version: 1,
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: {
            className: ['markdown-diagram-source', 'markdown-mermaid-source'],
          },
          children: [{ type: 'text', value: 'graph' }],
        },
        {
          type: 'element',
          tagName: 'pre',
          properties: {
            className: ['markdown-diagram-source', 'markdown-geojson-source'],
          },
          children: [{ type: 'text', value: 'map' }],
        },
      ],
    };

    await act(async () => {
      root.render(createElement(MarkdownContent, { tree, onClick: vi.fn() }));
    });
    const rendered = Array.from(
      container.querySelectorAll('.rendered-rich-fence'),
    );
    expect(rendered).toHaveLength(2);
    expect(container.querySelector('.markdown-diagram-source')).toBeNull();

    await act(async () => {
      root.render(createElement(MarkdownContent, { tree, onClick: vi.fn() }));
    });
    expect(
      Array.from(container.querySelectorAll('.rendered-rich-fence')),
    ).toEqual(rendered);
    expect(container.querySelector('.markdown-diagram-source')).toBeNull();
    expect(richRenderer).toHaveBeenCalledTimes(1);
  });

  // @lat: [[lat.md/view/specs#View Tests#Renders canonical document trees]]
  it('renders safe document nodes and section interactions through React', async () => {
    const onCopySectionLink = vi.fn();
    const onShowSectionOutput = vi.fn();
    const tree: ViewDocumentTree = {
      version: 1,
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'h2',
          properties: { id: 'auditing' },
          children: [{ type: 'text', value: 'Auditing' }],
        },
        {
          type: 'element',
          tagName: 'a',
          properties: {
            href: 'javascript:alert(1)',
            onClick: 'alert(2)',
          },
          children: [{ type: 'text', value: '<safe text>' }],
        },
      ],
    };

    await act(async () => {
      root.render(
        createElement(MarkdownContent, {
          backReferences: [
            {
              sectionId: 'lat.md/guide#Guide#Auditing',
              headingId: 'auditing',
              references: [],
            },
          ],
          onCopySectionLink,
          onShowSectionOutput,
          tree,
        }),
      );
    });

    const link = container.querySelector('a');
    expect(link?.textContent).toBe('<safe text>');
    expect(link?.hasAttribute('href')).toBe(false);
    expect(link?.hasAttribute('onclick')).toBe(false);

    const toggle = container.querySelector<HTMLButtonElement>(
      '.section-back-reference-toggle',
    );
    const panel = container.querySelector<HTMLElement>(
      '.section-back-reference-panel',
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(panel?.hidden).toBe(true);
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.hidden).toBe(false);
    expect(panel?.textContent).toContain('No references to this section');

    const actions = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.section-back-reference-action',
      ),
    );
    await act(async () => actions[0].click());
    await act(async () => actions[2].click());
    expect(onCopySectionLink).toHaveBeenCalledWith('auditing');
    expect(onShowSectionOutput).toHaveBeenCalledWith(
      'lat.md/guide#Guide#Auditing',
    );
  });
});
