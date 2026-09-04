// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
import { SearchResultCard } from '../view/src/SearchResultCard';
import type { ViewSearchResult } from '../src/view/protocol';

const result: ViewSearchResult = {
  sectionId: 'lat.md/guide#Guide#Link Syntax',
  title: 'Link Syntax',
  path: 'guide.md',
  breadcrumbs: ['guide', 'Guide', 'Link Syntax'],
  description: '',
  introduction: 'An overview.',
  url: '/guide#link-syntax',
  rankScore: 0.030622,
  lexicalRank: 9,
  semanticRank: 2,
  semanticSimilarity: 0.52648,
  evidence: [
    {
      chunkId: 'p1',
      channel: 'semantic',
      spans: [{ start: 0, end: 120, startLine: 9, endLine: 17 }],
      text: 'Use **external links** with `handle:path`.\n\n```ts\nconst link = "example";\n```\n\n| Name | Value |\n| --- | --- |\n| File | guide |\n\n<script>alert(1)</script>',
    },
  ],
};

describe('search result cards', () => {
  // @lat: [[view/specs#View Tests#Formats hybrid search results]]
  it('formats evidence safely and distinguishes hybrid scores from cosine similarity', () => {
    const html = renderToStaticMarkup(
      createElement(SearchResultCard, { result, rank: 3, onNavigate: vi.fn() }),
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('h2')?.textContent).toBe('3. Link Syntax');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/guide?match=9-17#link-syntax',
    );
    expect(container.querySelector('strong')?.textContent).toBe('0.030622');
    expect(container.textContent).toContain('Cosine similarity0.526');
    expect(container.textContent).toContain('Matched lines 9–17');
    expect(container.querySelector('.search-passage strong')?.textContent).toBe(
      'external links',
    );
    expect(container.querySelector('pre code')?.textContent).toContain(
      'const link',
    );
    expect(container.querySelector('table th')?.textContent).toBe('Name');
    expect(container.querySelector('script')).toBeNull();
    const lexical = renderToStaticMarkup(
      createElement(SearchResultCard, {
        result: {
          ...result,
          semanticRank: undefined,
          semanticSimilarity: undefined,
          evidence: [],
        },
        rank: 1,
        onNavigate: vi.fn(),
      }),
    );
    expect(lexical).toContain('Text match');
    expect(lexical).not.toContain('Cosine similarity');
  });
  // @lat: [[view/specs#View Tests#Expands matching passages]]
  it('expands and collapses a long passage without navigating away', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const navigate = vi.fn();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () =>
        root.render(
          createElement(SearchResultCard, {
            result,
            rank: 1,
            onNavigate: navigate,
          }),
        ),
      );
      const button = container.querySelector('button')!;
      expect(button.getAttribute('aria-expanded')).toBe('false');
      await act(async () => button.click());
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(container.querySelector('.search-passage-collapsed')).toBeNull();
      await act(async () => button.click());
      expect(
        container.querySelector('.search-passage-collapsed'),
      ).not.toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT;
    }
  });
});
