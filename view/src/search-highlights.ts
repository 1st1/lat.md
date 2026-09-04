import type { SourceSpan } from '../../src/search/types';

export function searchResultUrl(
  url: string,
  spans: readonly SourceSpan[],
): string {
  if (!spans.length) return url;
  const target = new URL(url, 'http://lat.local');
  target.searchParams.set(
    'match',
    spans.map((span) => `${span.startLine}-${span.endLine}`).join(','),
  );
  return `${target.pathname}${target.search}${target.hash}`;
}

export function searchMatchRanges(search: string): [number, number][] {
  const value = new URLSearchParams(search).get('match');
  if (!value || value.length > 2048) return [];
  return value
    .split(',')
    .slice(0, 64)
    .flatMap((part) => {
      const match = /^(\d+)-(\d+)$/.exec(part);
      if (!match) return [];
      const start = Number(match[1]),
        end = Number(match[2]);
      return Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start > 0 &&
        end >= start
        ? [[start, end] as [number, number]]
        : [];
    });
}

/** Highlight the smallest rendered blocks overlapping the matched source lines. */
export function applySearchHighlights(
  container: HTMLElement | null,
  search: string,
): HTMLElement[] {
  if (!container) return [];
  container
    .querySelectorAll('.search-match')
    .forEach((element) => element.classList.remove('search-match'));
  const ranges = searchMatchRanges(search);
  const candidates = [
    ...container.querySelectorAll<HTMLElement>(
      '[data-source-start-line][data-source-end-line]',
    ),
  ].filter((element) => {
    const start = Number(element.dataset.sourceStartLine),
      end = Number(element.dataset.sourceEndLine);
    return ranges.some(([from, to]) => start <= to && end >= from);
  });
  const matches = candidates.filter(
    (element) =>
      !candidates.some((other) => other !== element && element.contains(other)),
  );
  for (const element of matches) element.classList.add('search-match');
  return matches;
}
