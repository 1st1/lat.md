// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const richRenderer = vi.hoisted(() =>
  vi.fn<(props: { kind: string; source: string }) => void>(),
);

vi.mock('../view/src/MarkdownRichFence.js', async () => {
  const { createElement } = await import('react');
  return {
    MarkdownRichFence: (props: { kind: string; source: string }) => {
      richRenderer(props);
      return createElement(
        'figure',
        { className: 'rendered-rich-fence', 'data-kind': props.kind },
        props.source,
      );
    },
  };
});

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
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  // @lat: [[lat.md/view/specs#View Tests#Stabilizes fragment navigation immediately#Preserves rich renderers]]
  it('keeps rich fences React-owned across navigation and tree updates', async () => {
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
    expect(rendered.map((node) => node.textContent)).toEqual(['graph', 'map']);

    await act(async () => {
      root.render(createElement(MarkdownContent, { tree, onClick: vi.fn() }));
    });
    expect(
      Array.from(container.querySelectorAll('.rendered-rich-fence')),
    ).toEqual(rendered);
    expect(container.querySelector('.markdown-diagram-source')).toBeNull();

    const changedTree: ViewDocumentTree = {
      ...tree,
      children: [
        {
          ...tree.children[0],
          children: [{ type: 'text', value: 'graph TD' }],
        } as ViewDocumentTree['children'][number],
        tree.children[1],
      ],
    };
    await act(async () => {
      root.render(
        createElement(MarkdownContent, {
          tree: changedTree,
          onClick: vi.fn(),
        }),
      );
    });
    expect(container.querySelector('.rendered-rich-fence')).toBe(rendered[0]);
    expect(rendered[0].textContent).toBe('graph TD');
    expect(richRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'mermaid', source: 'graph TD' }),
    );
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
