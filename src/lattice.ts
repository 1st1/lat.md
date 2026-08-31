import { readFile } from 'node:fs/promises';
import { dirname, basename, relative } from 'node:path';
import GithubSlugger from 'github-slugger';
import { parse } from './parser.js';
import { toPosix } from './path.js';
import { visit } from 'unist-util-visit';
import { listLatticeFiles } from './project-discovery.js';
import type { LatFrontmatter, MdLink, Ref, Section } from './lattice-model.js';
import type {
  Definition,
  Heading,
  Image,
  Link,
  ListItem,
  Root,
  RootContent,
  Text,
} from 'mdast';
import type { WikiLink } from './extensions/wiki-link/types.js';
import type { Profiler } from './profiler.js';

export {
  buildFileIndex,
  buildSectionSlugIndex,
  findSections,
  flattenSections,
  resolveRef,
} from './lattice-model.js';
export type {
  LatFrontmatter,
  MdLink,
  Ref,
  ResolveResult,
  Section,
  SectionMatch,
  SectionSlugIndex,
} from './lattice-model.js';
export {
  findLatticeDir,
  findProjectRoot,
  listLatticeFiles,
} from './project-discovery.js';

export function parseFrontmatter(content: string): LatFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: LatFrontmatter = {};
  if (/require-code-mention:\s*true/i.test(yaml)) {
    result.requireCodeMention = true;
  }
  return result;
}

function headingText(node: Heading): string {
  return node.children
    .filter((c): c is Text => c.type === 'text')
    .map((c) => c.value)
    .join('');
}

/** Extract the rendered text GitHub uses as input to its heading slugger. */
function githubHeadingText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';

  const value = node as {
    type?: string;
    value?: string;
    alt?: string | null;
    data?: { alias?: string | null };
    children?: unknown[];
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
  if (value.children) {
    return value.children.map(githubHeadingText).join('');
  }
  return '';
}

function inlineText(node: { children: RootContent[] }): string {
  return node.children
    .map((c) => {
      if (c.type === 'text') return c.value;
      if (c.type === 'inlineCode') return '`' + c.value + '`';
      if (c.type === 'wikiLink') return '[[' + c.value + ']]';
      if ('children' in c) return inlineText(c as { children: RootContent[] });
      return '';
    })
    .join('');
}

function lastLine(content: string): number {
  const lines = content.split('\n');
  // If trailing newline, count doesn't include empty last line
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

export function parseSections(
  filePath: string,
  content: string,
  projectRoot?: string,
  tree: Root = parse(content),
): Section[] {
  const file = projectRoot
    ? toPosix(relative(projectRoot, filePath)).replace(/\.md$/, '')
    : basename(filePath, '.md');
  const sectionFilePath = projectRoot
    ? toPosix(relative(projectRoot, filePath))
    : basename(filePath);
  const roots: Section[] = [];
  const stack: Section[] = [];
  const flat: Section[] = [];
  const slugger = new GithubSlugger();

  visit(tree, 'heading', (node: Heading) => {
    const heading = headingText(node);
    const depth = node.depth;
    const startLine = node.position!.start.line;

    // Pop stack until we find a parent with smaller depth
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const id = parent ? `${parent.id}#${heading}` : `${file}#${heading}`;

    const section: Section = {
      id,
      heading,
      depth,
      file,
      filePath: sectionFilePath,
      children: [],
      startLine,
      endLine: 0,
      firstParagraph: '',
      githubSlug: slugger.slug(githubHeadingText(node)),
    };

    if (parent) {
      parent.children.push(section);
    } else {
      roots.push(section);
    }

    stack.push(section);
    flat.push(section);
  });

  // Compute endLine: line before next heading or last line of file
  const fileLastLine = lastLine(content);
  for (let i = 0; i < flat.length; i++) {
    if (i + 1 < flat.length) {
      flat[i].endLine = flat[i + 1].startLine - 1;
    } else {
      flat[i].endLine = fileLastLine;
    }
  }

  // Extract firstParagraph: first paragraph after each heading
  const children = tree.children;
  let headingIdx = 0;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === 'heading') {
      // Find the first paragraph after this heading, before the next heading
      for (let j = i + 1; j < children.length; j++) {
        if (children[j].type === 'heading') break;
        if (children[j].type === 'paragraph') {
          flat[headingIdx].firstParagraph = inlineText(
            children[j] as unknown as { children: RootContent[] },
          );
          break;
        }
      }
      headingIdx++;
    }
  }

  return roots;
}

export async function loadAllSections(
  latticeDir: string,
  projectRoot = dirname(latticeDir),
  profile?: Profiler,
): Promise<Section[]> {
  const files = profile
    ? await profile.time('list Markdown files', () =>
        listLatticeFiles(latticeDir),
      )
    : await listLatticeFiles(latticeDir);
  const all: Section[] = [];
  for (const file of files) {
    const detail = toPosix(relative(latticeDir, file));
    const content = profile
      ? await profile.time(
          'read Markdown file',
          () => readFile(file, 'utf-8'),
          detail,
        )
      : await readFile(file, 'utf-8');
    const sections = profile
      ? profile.timeSync(
          'parse Markdown sections',
          () => parseSections(file, content, projectRoot),
          detail,
        )
      : parseSections(file, content, projectRoot);
    all.push(...sections);
  }
  return all;
}

export function extractRefs(
  filePath: string,
  content: string,
  projectRoot?: string,
  tree: Root = parse(content),
): Ref[] {
  const file = projectRoot
    ? toPosix(relative(projectRoot, filePath)).replace(/\.md$/, '')
    : basename(filePath, '.md');
  const refs: Ref[] = [];

  // Build a flat list of sections to determine enclosing section for each wiki link
  const flat: { id: string; startLine: number }[] = [];
  visit(tree, 'heading', (node: Heading) => {
    flat.push({
      id: '', // filled below
      startLine: node.position!.start.line,
    });
  });

  // Re-derive ids using the same logic as parseSections
  const stack: { id: string; depth: number }[] = [];
  let idx = 0;
  visit(tree, 'heading', (node: Heading) => {
    const heading = headingText(node);
    const depth = node.depth;
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const id = parent ? `${parent.id}#${heading}` : `${file}#${heading}`;
    flat[idx].id = id;
    stack.push({ id, depth });
    idx++;
  });

  visit(tree, 'wikiLink', (node: WikiLink) => {
    const line = node.position!.start.line;

    // Find enclosing section: last heading with startLine <= link line
    let fromSection = '';
    for (const s of flat) {
      if (s.startLine <= line) {
        fromSection = s.id;
      } else {
        break;
      }
    }

    refs.push({
      target: node.value,
      fromSection,
      file,
      line,
    });
  });

  return refs;
}

function isEscapedAt(value: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function closingBracket(value: string, open: number): number {
  let depth = 0;
  for (let i = open; i < value.length; i++) {
    if (isEscapedAt(value, i)) continue;
    if (value[i] === '[') {
      depth++;
    } else if (value[i] === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract link destinations and undefined reference syntax. */
export function extractLinks(
  content: string,
  tree: Root = parse(content),
): MdLink[] {
  const links: MdLink[] = [];

  visit(tree, ['link', 'image', 'definition'], (node) => {
    const { url, type, position } = node as Link | Image | Definition;
    links.push({ url, kind: type, line: position!.start.line });
  });

  // CommonMark parses a reference with no matching definition as plain text,
  // so it has no linkReference node to visit. Scan the authored syntax while
  // excluding AST ranges where bracket text is data rather than prose.
  const excluded: { start: number; end: number }[] = [];
  visit(
    tree,
    [
      'code',
      'inlineCode',
      'html',
      'math',
      'inlineMath',
      'yaml',
      'link',
      'image',
      'definition',
      'linkReference',
      'imageReference',
      'footnoteReference',
      'alertMarker',
      'wikiLink',
    ],
    (node) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        excluded.push({ start, end });
      }
    },
  );

  // GFM removes task-list markers from the paragraph AST. Exclude just the
  // marker prefix so strict shortcut checks still apply to the item body.
  visit(tree, 'listItem', (node: ListItem) => {
    if (typeof node.checked !== 'boolean') return;
    const start = node.position?.start.offset;
    const bodyStart = node.children[0]?.position?.start.offset;
    if (start === undefined || bodyStart === undefined) return;
    const marker = /\[[ xX]\]/.exec(content.slice(start, bodyStart));
    if (marker) {
      excluded.push({
        start: start + marker.index,
        end: start + marker.index + marker[0].length,
      });
    }
  });

  // Likewise, exclude only a footnote definition's label and delimiter. Its
  // body remains prose and must still obey strict shortcut validation.
  visit(tree, 'footnoteDefinition', (node) => {
    const start = node.position?.start.offset;
    const bodyStart = node.children[0]?.position?.start.offset;
    if (start !== undefined && bodyStart !== undefined) {
      excluded.push({ start, end: bodyStart });
    }
  });

  const overlapsExcluded = (start: number, end: number) =>
    excluded.some((range) => start < range.end && end > range.start);

  for (let open = 0; open < content.length; open++) {
    if (content[open] !== '[' || isEscapedAt(content, open)) continue;

    const labelEnd = closingBracket(content, open);
    if (labelEnd === -1) continue;

    const identifierStart = labelEnd + 1;
    const hasSecondLabel =
      content[identifierStart] === '[' &&
      !isEscapedAt(content, identifierStart);
    const identifierEnd = hasSecondLabel
      ? closingBracket(content, identifierStart)
      : labelEnd;
    if (identifierEnd === -1) continue;

    const isImage =
      open > 0 && content[open - 1] === '!' && !isEscapedAt(content, open - 1);
    const isMalformedDefinition =
      !isImage && !hasSecondLabel && content[labelEnd + 1] === ':';
    const start = isImage ? open - 1 : open;
    const end = identifierEnd + 1 + (isMalformedDefinition ? 1 : 0);
    if (overlapsExcluded(start, end)) {
      open = identifierEnd;
      continue;
    }

    const explicitIdentifier = hasSecondLabel
      ? content.slice(identifierStart + 1, identifierEnd)
      : '';
    const identifier = explicitIdentifier || content.slice(open + 1, labelEnd);
    if (identifier.trim() === '') {
      open = identifierEnd;
      continue;
    }

    links.push({
      identifier: identifier.trim(),
      source: content.slice(start, end),
      kind: isImage ? 'imageReference' : 'linkReference',
      style: !hasSecondLabel
        ? isMalformedDefinition
          ? 'definition'
          : 'shortcut'
        : explicitIdentifier
          ? 'full'
          : 'collapsed',
      line: content.slice(0, start).split('\n').length,
    });
    open = identifierEnd;
  }

  return links.sort((a, b) => a.line - b.line);
}
