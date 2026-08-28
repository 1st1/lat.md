import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import { gfmAutolinkLiteralFromMarkdown } from 'mdast-util-gfm-autolink-literal';
import {
  gfmStrikethroughFromMarkdown,
  gfmStrikethroughToMarkdown,
} from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown, gfmTableToMarkdown } from 'mdast-util-gfm-table';
import {
  gfmTaskListItemFromMarkdown,
  gfmTaskListItemToMarkdown,
} from 'mdast-util-gfm-task-list-item';
import { gfmAutolinkLiteral } from 'micromark-extension-gfm-autolink-literal';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import type { Link, Root } from 'mdast';
import { visit } from 'unist-util-visit';
import {
  alertMarkerToMarkdown,
  markAlertMarkers,
} from './extensions/alert-marker.js';
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
    gfmAutolinkLiteral(),
    gfmStrikethrough(),
    gfmTable(),
    gfmTaskListItem(),
    wikiLinkSyntax(),
  ])
  .data('fromMarkdownExtensions', [
    gfmAutolinkLiteralFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
    wikiLinkFromMarkdown(),
  ])
  .data('toMarkdownExtensions', [
    alertMarkerToMarkdown(),
    gfmStrikethroughToMarkdown(),
    gfmTableToMarkdown(),
    gfmTaskListItemToMarkdown(),
    wikiLinkToMarkdown(),
  ]);

const BARE_AUTOLINK_DATA_KEY = 'latBareAutolink';

function bareAutolinkText(node: Link): string | null {
  if (node.children.length !== 1 || node.children[0].type !== 'text') {
    return null;
  }
  const text = node.children[0].value;
  if (
    node.url !== text &&
    node.url !== `http://${text}` &&
    node.url !== `mailto:${text}`
  ) {
    return null;
  }
  return text;
}

export function parse(markdown: string): Root {
  const tree = processor.parse(markdown);
  markAlertMarkers(tree);
  visit(tree, 'link', (node: Link) => {
    const text = bareAutolinkText(node);
    const sourceLength =
      node.position?.end.offset !== undefined &&
      node.position.start.offset !== undefined
        ? node.position.end.offset - node.position.start.offset
        : null;
    if (text === null || sourceLength !== text.length) return;
    node.data = {
      ...node.data,
      [BARE_AUTOLINK_DATA_KEY]: true,
    } as NonNullable<Link['data']>;
  });
  return tree;
}

export function toMarkdown(tree: Root): string {
  const serializable = structuredClone(tree);
  visit(serializable, 'link', (node: Link, index, parent) => {
    if (
      index === undefined ||
      !parent ||
      (node.data as Record<string, unknown> | undefined)?.[
        BARE_AUTOLINK_DATA_KEY
      ] !== true
    ) {
      return;
    }
    const text = bareAutolinkText(node);
    if (text === null) return;
    parent.children[index] = { type: 'text', value: text };
  });
  return processor.stringify(serializable);
}
