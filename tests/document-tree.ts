import rehypeStringify from 'rehype-stringify';
import { unified } from 'unified';
import type { ViewDocumentTree } from '../src/view/protocol.js';

const serializer = unified().use(rehypeStringify);

/** Test-only projection used to keep exact rendering parity assertions. */
export function documentTreeToHtml(tree: ViewDocumentTree): string {
  return serializer.stringify({ type: 'root', children: tree.children });
}
