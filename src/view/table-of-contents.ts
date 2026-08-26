import type { Heading, Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { flattenSections, type Section } from '../lattice.js';
import type { ViewDocumentTocItem } from './protocol.js';

function headingText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const value = node as {
    alt?: string | null;
    children?: unknown[];
    data?: { alias?: string | null };
    type?: string;
    value?: string;
  };
  if (value.type === 'text' || value.type === 'inlineCode') {
    return value.value ?? '';
  }
  if (value.type === 'image' || value.type === 'imageReference') {
    return value.alt ?? '';
  }
  if (value.type === 'wikiLink') {
    return value.data?.alias ?? value.value ?? '';
  }
  return value.children?.map(headingText).join('') ?? '';
}

/** Project rendered headings into the document's local navigation. */
export function buildViewTableOfContents(
  sections: Section[],
  tree: Root,
): ViewDocumentTocItem[] {
  const titles: string[] = [];
  visit(tree, 'heading', (node: Heading) => {
    titles.push(headingText(node));
  });

  return flattenSections(sections).flatMap((section, index) =>
    section.githubSlug
      ? [
          {
            id: section.githubSlug,
            title: titles[index] || section.heading,
            depth: section.depth,
          },
        ]
      : [],
  );
}
