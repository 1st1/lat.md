// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown } from '../src/view/markdown';
import { MarkdownContent } from '../view/src/MarkdownContent';
import {
  applySearchHighlights,
  searchMatchRanges,
  searchResultUrl,
} from '../view/src/search-highlights';

describe('search destination highlights', () => {
  // @lat: [[view/specs#View Tests#Highlights search destination passages]]
  it('retains source positions through rendering and marks only matching document blocks', async () => {
    const markdown =
      '# Guide\n\nIntroduction.\n\n## Detail\n\nMatching paragraph with **bold** text.\n\n```ts\nconst answer = 42;\n```\n\nUnrelated paragraph.\n';
    const { tree } = await renderMarkdown(markdown, 'guide.md');
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      createElement(MarkdownContent, { tree }),
    );
    const article = container.querySelector<HTMLElement>('article')!;
    const spans = [
      { start: 0, end: 0, startLine: 7, endLine: 7 },
      { start: 0, end: 0, startLine: 10, endLine: 10 },
    ];
    const url = searchResultUrl('/guide#detail', spans);
    expect(url).toBe('/guide?match=7-7%2C10-10#detail');
    const matches = applySearchHighlights(
      article,
      new URL(url, 'https://lat.test').search,
    );
    expect(matches.map((element) => element.tagName)).toEqual(['P', 'PRE']);
    expect(matches[0].textContent).toContain('Matching paragraph');
    expect(article.querySelectorAll('.search-match')).toHaveLength(2);
    expect(applySearchHighlights(article, '')).toEqual([]);
    expect(article.querySelectorAll('.search-match')).toHaveLength(0);
  });
  // @lat: [[view/specs#View Tests#Validates search highlight ranges]]
  it('ignores invalid ranges and does not highlight whole lists for a nested match', () => {
    expect(searchMatchRanges('?match=0-1,5-2,NaN-4,3-3')).toEqual([[3, 3]]);
    expect(
      searchMatchRanges('?match=999999999999999999-999999999999999999'),
    ).toEqual([]);
    expect(searchResultUrl('/guide#detail', [])).toBe('/guide#detail');
    const container = document.createElement('div');
    container.innerHTML =
      '<article><li data-source-start-line="2" data-source-end-line="8"><p data-source-start-line="3" data-source-end-line="4">match</p></li></article>';
    expect(
      applySearchHighlights(
        container.querySelector('article'),
        '?match=3-3',
      ).map((element) => element.tagName),
    ).toEqual(['P']);
    expect(applySearchHighlights(null, '?match=3-3')).toEqual([]);
  });
});
