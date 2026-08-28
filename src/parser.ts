import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import {
  gfmStrikethroughFromMarkdown,
  gfmStrikethroughToMarkdown,
} from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import type { Root } from 'mdast';
import {
  wikiLinkSyntax,
  wikiLinkFromMarkdown,
  wikiLinkToMarkdown,
} from './extensions/wiki-link/index.js';

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter)
  .use(remarkStringify)
  .data('micromarkExtensions', [
    gfmStrikethrough(),
    gfmTable(),
    wikiLinkSyntax(),
  ])
  .data('fromMarkdownExtensions', [
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    wikiLinkFromMarkdown(),
  ])
  .data('toMarkdownExtensions', [
    gfmStrikethroughToMarkdown(),
    gfmTableToMarkdown(),
    wikiLinkToMarkdown(),
  ]);

export function parse(markdown: string): Root {
  return processor.parse(markdown);
}

export function toMarkdown(tree: Root): string {
  return processor.stringify(tree);
}
