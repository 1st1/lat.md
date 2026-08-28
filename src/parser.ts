import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table';
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
  .data('micromarkExtensions', [gfmTable(), wikiLinkSyntax()])
  .data('fromMarkdownExtensions', [
    gfmTableFromMarkdown(),
    wikiLinkFromMarkdown(),
  ])
  .data('toMarkdownExtensions', [gfmTableToMarkdown(), wikiLinkToMarkdown()]);

export function parse(markdown: string): Root {
  return processor.parse(markdown);
}

export function toMarkdown(tree: Root): string {
  return processor.stringify(tree);
}
