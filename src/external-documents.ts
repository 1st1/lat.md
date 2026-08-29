import { posix } from 'node:path';
import { flattenSections, type Section } from './lattice.js';
import { analyzeMarkdownFile } from './markdown-analysis.js';
import { documentFormat, type DocumentFormat } from './document-formats.js';

export type ExternalDocumentSection = {
  title: string;
  depth: number;
  anchor: string;
  aliases: string[];
  hierarchy: string[];
  startLine: number;
  endLine: number;
};

/** Serializable document facts retained after a format parser discards its AST. */
export type ExternalDocumentAnalysis = {
  format: DocumentFormat;
  title: string;
  sections: ExternalDocumentSection[];
};

type OpenSection = Omit<ExternalDocumentSection, 'endLine'>;

function unique(values: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    result.push(trimmed);
  }
  return result;
}

function closeSections(
  sections: OpenSection[],
  finalLine: number,
): ExternalDocumentSection[] {
  return sections.map((section, index) => {
    const next = sections
      .slice(index + 1)
      .find((candidate) => candidate.depth <= section.depth);
    return {
      ...section,
      endLine: next
        ? Math.max(section.startLine, next.startLine - 1)
        : finalLine,
    };
  });
}

function markdownAnalysis(
  path: string,
  content: string,
): ExternalDocumentAnalysis {
  const virtual = `/external/${path}`;
  const analysis = analyzeMarkdownFile(virtual, content, '/', '/');
  const parents: Array<{ depth: number; title: string }> = [];
  const sections = flattenSections(analysis.sections).map((section, index) => {
    const title = analysis.headingTitles[index] ?? section.heading;
    while (
      parents.length > 0 &&
      parents[parents.length - 1].depth >= section.depth
    ) {
      parents.pop();
    }
    const hierarchy = [...parents.map((parent) => parent.title), title];
    const legacyHierarchy = section.id.split('#').slice(1);
    parents.push({ depth: section.depth, title });
    return {
      title,
      depth: section.depth,
      anchor: section.githubSlug ?? '',
      aliases: unique([
        hierarchy.join('#'),
        legacyHierarchy.join('#'),
        title,
        section.heading,
        section.githubSlug,
      ]),
      hierarchy,
      startLine: section.startLine,
    };
  });
  return {
    format: 'markdown',
    title: analysis.headingTitles[0] ?? posix.basename(path, '.md'),
    sections: closeSections(sections, content.split('\n').length),
  };
}

async function restructuredTextAnalysis(
  path: string,
  content: string,
): Promise<ExternalDocumentAnalysis> {
  const { RstSection, RstToHtmlCompiler } = await import('rst-compiler');
  const compiler = new RstToHtmlCompiler();
  const parsed = compiler.parse(content, {
    disableErrors: true,
    disableWarnings: true,
  });
  const nodes = parsed.root
    .findAllChildren('Section')
    .filter((node): node is InstanceType<typeof RstSection> =>
      Boolean(node instanceof RstSection),
    );
  const aliasesByNode = new Map<object, string[]>();
  for (const [alias, node] of parsed.simpleNameResolver
    .nodesLinkableFromOutside) {
    const aliases = aliasesByNode.get(node) ?? [];
    aliases.push(alias);
    aliasesByNode.set(node, aliases);
  }
  const hierarchy: string[] = [];
  const sections = nodes.map((node) => {
    hierarchy.length = node.level - 1;
    hierarchy.push(node.textContent);
    const anchor = parsed.htmlAttrResolver.getNodeHtmlId(node) ?? '';
    return {
      title: node.textContent,
      depth: node.level,
      anchor,
      aliases: unique([
        hierarchy.join('#'),
        node.textContent,
        anchor,
        ...(aliasesByNode.get(node) ?? []),
      ]),
      hierarchy: [...hierarchy],
      startLine: node.source.startLineIdx + 1,
    };
  });
  return {
    format: 'restructuredtext',
    title: sections[0]?.title ?? posix.basename(path, '.rst'),
    sections: closeSections(sections, content.split('\n').length),
  };
}

/** Accept legacy AsciiDoc source listings whose delimiter lengths do not match. */
function asciidocCompatibleContent(content: string): string {
  const lines = content.split('\n');
  for (let index = 0; index + 1 < lines.length; index++) {
    if (!/^\[(?:source|listing)(?:,|\])/i.test(lines[index].trim())) continue;
    if (!/^-{5,}\r?$/.test(lines[index + 1])) continue;
    for (let closing = index + 2; closing < lines.length; closing++) {
      if (!/^-{4,}\r?$/.test(lines[closing])) continue;
      const openingCr = lines[index + 1].endsWith('\r') ? '\r' : '';
      const closingCr = lines[closing].endsWith('\r') ? '\r' : '';
      lines[index + 1] = `----${openingCr}`;
      lines[closing] = `----${closingCr}`;
      index = closing;
      break;
    }
  }
  return lines.join('\n');
}

async function asciidocAnalysis(
  path: string,
  content: string,
): Promise<ExternalDocumentAnalysis> {
  const { load } = await import('@asciidoctor/core');
  const document = await load(asciidocCompatibleContent(content), {
    safe: 'secure',
    sourcemap: true,
    attributes: { showtitle: true },
  });
  const sections: OpenSection[] = [];
  const documentTitle = document.getTitle();
  const documentId = document.getId() ?? '';
  const rootHierarchy = documentTitle ? [documentTitle] : [];
  if (documentTitle) {
    sections.push({
      title: documentTitle,
      depth: 1,
      anchor: documentId,
      aliases: unique([documentTitle, documentId]),
      hierarchy: rootHierarchy,
      startLine: document.getLineNumber() ?? 1,
    });
  }
  const visit = (
    nodes: ReturnType<typeof document.getSections>,
    parents: string[],
  ): void => {
    for (const node of nodes) {
      const title = node.getTitle() ?? '';
      const hierarchy = [...parents, title];
      const anchor = node.getId() ?? '';
      const level = node.getLevel();
      sections.push({
        title,
        depth:
          level == null ? hierarchy.length : level + (documentTitle ? 1 : 0),
        anchor,
        aliases: unique([hierarchy.join('#'), title, anchor]),
        hierarchy,
        startLine: node.getLineNumber() ?? 1,
      });
      visit(node.getSections(), hierarchy);
    }
  };
  visit(document.getSections(), rootHierarchy);
  const extension = path.toLowerCase().endsWith('.asciidoc')
    ? '.asciidoc'
    : '.adoc';
  return {
    format: 'asciidoc',
    title:
      documentTitle ?? sections[0]?.title ?? posix.basename(path, extension),
    sections: closeSections(sections, content.split('\n').length),
  };
}

export async function analyzeExternalDocument(
  path: string,
  content: string,
): Promise<ExternalDocumentAnalysis> {
  switch (documentFormat(path)) {
    case 'markdown':
      return markdownAnalysis(path, content);
    case 'restructuredtext':
      return restructuredTextAnalysis(path, content);
    case 'asciidoc':
      return asciidocAnalysis(path, content);
    default:
      throw new Error(`unsupported external document format for "${path}"`);
  }
}

export function findExternalDocumentSection(
  analysis: ExternalDocumentAnalysis,
  fragment: string,
): ExternalDocumentSection | undefined {
  const wanted = fragment.toLowerCase();
  return analysis.sections.find((section) =>
    section.aliases.some((alias) => alias.toLowerCase() === wanted),
  );
}

/** Project format-neutral document sections into the existing browser TOC model. */
export function externalDocumentSections(
  path: string,
  analysis: ExternalDocumentAnalysis,
): Section[] {
  const roots: Section[] = [];
  const parents: Section[] = [];
  for (const source of analysis.sections) {
    const section: Section = {
      id: `${path}#${source.hierarchy.join('#')}`,
      heading: source.title,
      depth: source.depth,
      file: path,
      filePath: path,
      children: [],
      startLine: source.startLine,
      endLine: source.endLine,
      firstParagraph: '',
      githubSlug: source.anchor,
    };
    while (
      parents.length > 0 &&
      parents[parents.length - 1].depth >= section.depth
    ) {
      parents.pop();
    }
    const parent = parents[parents.length - 1];
    if (parent) parent.children.push(section);
    else roots.push(section);
    parents.push(section);
  }
  return roots;
}

function htmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Add safe zero-size anchors for accepted aliases that differ from rendered IDs. */
export function addExternalDocumentAliasAnchors(
  html: string,
  analysis: ExternalDocumentAnalysis,
): string {
  const canonical = new Set(
    analysis.sections.map((section) => section.anchor).filter(Boolean),
  );
  for (const section of analysis.sections) {
    if (!section.anchor) continue;
    const aliases = section.aliases.filter(
      (alias) => alias !== section.anchor && !canonical.has(alias),
    );
    if (aliases.length === 0) continue;
    const marker = `id="${htmlAttribute(section.anchor)}"`;
    const heading = html.lastIndexOf('<h', html.indexOf(marker));
    if (heading < 0) continue;
    const anchors = aliases
      .map(
        (alias) =>
          `<span id="${htmlAttribute(alias)}" aria-hidden="true"></span>`,
      )
      .join('');
    html = `${html.slice(0, heading)}${anchors}${html.slice(heading)}`;
  }
  return html;
}

/** Render a non-Markdown external document with its native processor. */
export async function renderExternalDocument(
  format: Exclude<DocumentFormat, 'markdown'>,
  content: string,
): Promise<string> {
  if (format === 'restructuredtext') {
    const { RstToHtmlCompiler } = await import('rst-compiler');
    const compiler = new RstToHtmlCompiler();
    return compiler.compile(
      content,
      { disableErrors: true, disableWarnings: true },
      { disableErrors: true, disableWarnings: true },
    ).body;
  }
  const { load } = await import('@asciidoctor/core');
  const document = await load(asciidocCompatibleContent(content), {
    safe: 'secure',
    attributes: { showtitle: true },
  });
  const html = await document.convert({ standalone: false });
  if (typeof html !== 'string') {
    throw new Error('AsciiDoc renderer did not return HTML');
  }
  return html;
}
