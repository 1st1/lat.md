import { posix } from 'node:path';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  flattenSections,
  resolveRef,
  type Section,
} from '../lattice-model.js';
import type {
  ViewDocumentError,
  ViewGraph,
  ViewGraphEdge,
  ViewGraphEdgeKind,
  ViewGraphNode,
} from './protocol.js';
import { linkedSection } from './references.js';
import type {
  ViewCodeReferenceFile,
  ViewParsedMarkdownFile,
} from './references.js';
import { viewSourceTarget } from './source-target.js';
import type { ViewGitSnapshot } from './git.js';
import type { ExternalResolver, ExternalTarget } from '../external-sources.js';
import { isDocumentPath, stripDocumentExtension } from '../document-formats.js';

function encodedPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function documentUrl(path: string, fragment = ''): string {
  return `/docs/${encodedPath(path)}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}

function sourceUrl(path: string, symbol = '', line = 0): string {
  const search = line > 0 ? `?at=${line}` : '';
  const fragment = symbol ? `#${encodeURIComponent(symbol)}` : '';
  return `/code/${encodedPath(path)}${search}${fragment}`;
}

function externalUrl(target: string): string {
  const colon = target.indexOf(':');
  const hash = target.indexOf('#', colon + 1);
  const handle = target.slice(0, colon);
  const path =
    hash === -1 ? target.slice(colon + 1) : target.slice(colon + 1, hash);
  const fragment = hash === -1 ? '' : target.slice(hash + 1);
  return `/external/${encodeURIComponent(handle)}/${encodedPath(path)}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
}

function externalNodeTarget(target: ExternalTarget): string {
  if (!isDocumentPath(target.resolvedPath)) return target.identity;
  const hash = target.identity.indexOf('#');
  return hash === -1 ? target.identity : target.identity.slice(0, hash);
}

function pathBreadcrumbs(path: string): string[] {
  return stripDocumentExtension(path).split('/');
}

function nodeLabelFromPath(path: string): string {
  return posix.basename(stripDocumentExtension(path));
}

/** Project the cached view state into stable nodes and weighted relationships. */
export function buildViewGraph(
  markdownFiles: Iterable<ViewParsedMarkdownFile>,
  codeFiles: Iterable<ViewCodeReferenceFile>,
  allSections: Section[],
  diagnostics: ReadonlyMap<string, readonly ViewDocumentError[]>,
  git: ViewGitSnapshot,
  generation: number,
  external?: ExternalResolver,
): ViewGraph {
  const files = [...markdownFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const sections = flattenSections(allSections);
  const sectionIds = new Set(
    sections.map((section) => section.id.toLowerCase()),
  );
  const fileIndex = buildFileIndex(allSections);
  const slugIndex = buildSectionSlugIndex(allSections);
  const sectionById = new Map(
    sections.map((section) => [section.id.toLowerCase(), section]),
  );
  const sectionsByPath = new Map<string, Section[]>();
  const documentNodeBySection = new Map<string, string>();
  const nodes = new Map<string, ViewGraphNode>();
  const edges = new Map<string, ViewGraphEdge>();
  const invalidWikiTargets = new Set<string>();

  for (const [path, errors] of diagnostics) {
    for (const error of errors) {
      invalidWikiTargets.add(`${path}\0${error.line}\0${error.target}`);
    }
  }

  const addNode = (node: ViewGraphNode): string => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return node.id;
  };
  const addEdge = (from: string, to: string, kind: ViewGraphEdgeKind): void => {
    if (from === to) return;
    const key = `${kind}\0${from}\0${to}`;
    const existing = edges.get(key);
    if (existing) {
      existing.weight++;
      return;
    }
    edges.set(key, {
      id: `edge:${kind}:${from}->${to}`,
      from,
      to,
      kind,
      weight: 1,
    });
  };

  for (const file of files) {
    const flat = flattenSections(file.sections);
    sectionsByPath.set(file.path.toLowerCase(), flat);

    const root = file.sections[0];
    const id = `document:${file.path}`;
    for (const section of flat) {
      documentNodeBySection.set(section.id.toLowerCase(), id);
    }
    const errorCount = diagnostics.get(file.path)?.length ?? 0;
    addNode({
      id,
      kind: 'document',
      label: root?.heading ?? nodeLabelFromPath(file.path),
      url: documentUrl(file.path),
      breadcrumbs: pathBreadcrumbs(file.path),
      documentPath: file.path,
      sectionId: root?.id,
      inDegree: 0,
      outDegree: 0,
      ...(git.files.get(file.path)?.status
        ? { gitStatus: git.files.get(file.path)?.status }
        : {}),
      ...(errorCount > 0 ? { errorCount } : {}),
    });
  }

  const documentNodeForSection = (section: Section): string | null =>
    documentNodeBySection.get(section.id.toLowerCase()) ?? null;

  for (const file of files) {
    const fileSections = flattenSections(file.sections).sort(
      (left, right) => left.startLine - right.startLine,
    );
    const containingSection = (line: number): Section | undefined =>
      fileSections.filter((section) => section.startLine <= line).at(-1) ??
      file.sections[0];

    for (const ref of file.wikiRefs) {
      const sourceSection = sectionById.get(ref.fromSection.toLowerCase());
      const from = sourceSection ? documentNodeForSection(sourceSection) : null;
      if (!from) continue;

      let externalTarget: ExternalTarget | null = null;
      try {
        externalTarget = external?.parse(ref.target) ?? null;
      } catch {
        continue;
      }
      if (externalTarget) {
        const target = externalNodeTarget(externalTarget);
        const document = isDocumentPath(externalTarget.resolvedPath);
        const to = addNode({
          id: `${document ? 'external-document' : 'external-source'}:${target}`,
          kind: document ? 'document' : 'source',
          label: document
            ? nodeLabelFromPath(externalTarget.resolvedPath)
            : externalTarget.fragment ||
              posix.basename(externalTarget.authoredPath),
          url: externalUrl(target),
          breadcrumbs: [
            externalTarget.handle,
            ...externalTarget.authoredPath.split('/'),
            ...(!document && externalTarget.fragment
              ? [externalTarget.fragment]
              : []),
          ],
          externalTarget: target,
          inDegree: 0,
          outDegree: 0,
        });
        addEdge(from, to, document ? 'wiki' : 'source');
        continue;
      }

      const source = viewSourceTarget(ref.target);
      if (source) {
        if (
          invalidWikiTargets.has(`${file.path}\0${ref.line}\0${ref.target}`)
        ) {
          continue;
        }
        const sourceId = addNode({
          id: `source:${source.path}${source.symbol ? `#${source.symbol}` : ''}`,
          kind: 'source',
          label: source.symbol || posix.basename(source.path),
          url: sourceUrl(source.path, source.symbol),
          breadcrumbs: [
            ...source.path.split('/'),
            ...(source.symbol ? [source.symbol] : []),
          ],
          sourcePath: source.path,
          symbol: source.symbol || undefined,
          inDegree: 0,
          outDegree: 0,
        });
        addEdge(from, sourceId, 'source');
        continue;
      }

      const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
      if (resolved.ambiguous) continue;
      const target = sectionById.get(resolved.resolved.toLowerCase());
      const to = target ? documentNodeForSection(target) : null;
      if (to) addEdge(from, to, 'wiki');
    }

    for (const link of file.markdownLinks) {
      if (link.kind !== 'link') continue;
      const target = linkedSection(link.url, file.path, sectionsByPath);
      const source = containingSection(link.line);
      const from = source ? documentNodeForSection(source) : null;
      const to = target ? documentNodeForSection(target) : null;
      if (from && to) addEdge(from, to, 'markdown');
    }
  }

  for (const file of [...codeFiles].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    for (const ref of [...file.refs].sort(
      (left, right) => left.line - right.line,
    )) {
      let externalTarget: ExternalTarget | null = null;
      try {
        externalTarget = external?.parse(ref.target) ?? null;
      } catch {
        continue;
      }
      if (externalTarget) {
        const target = externalNodeTarget(externalTarget);
        const document = isDocumentPath(externalTarget.resolvedPath);
        const to = addNode({
          id: `${document ? 'external-document' : 'external-source'}:${target}`,
          kind: document ? 'document' : 'source',
          label: document
            ? nodeLabelFromPath(externalTarget.resolvedPath)
            : externalTarget.fragment ||
              posix.basename(externalTarget.authoredPath),
          url: externalUrl(target),
          breadcrumbs: [
            externalTarget.handle,
            ...externalTarget.authoredPath.split('/'),
          ],
          externalTarget: target,
          inDegree: 0,
          outDegree: 0,
        });
        const snippet = file.lines[ref.line - 1]?.trim() ?? '';
        const from = addNode({
          id: `code-ref:${file.path}:${ref.line}`,
          kind: 'code-reference',
          label: `${posix.basename(file.path)}:${ref.line}`,
          url: sourceUrl(file.path, '', ref.line),
          breadcrumbs: [...file.path.split('/'), `line ${ref.line}`],
          sourcePath: file.path,
          line: ref.line,
          snippet,
          inDegree: 0,
          outDegree: 0,
        });
        addEdge(from, to, 'code-mention');
        continue;
      }
      const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
      if (resolved.ambiguous) continue;
      const target = sectionById.get(resolved.resolved.toLowerCase());
      const to = target ? documentNodeForSection(target) : null;
      if (!to) continue;
      const snippet = file.lines[ref.line - 1]?.trim() ?? '';
      const from = addNode({
        id: `code-ref:${file.path}:${ref.line}`,
        kind: 'code-reference',
        label: `${posix.basename(file.path)}:${ref.line}`,
        url: sourceUrl(file.path, '', ref.line),
        breadcrumbs: [...file.path.split('/'), `line ${ref.line}`],
        sourcePath: file.path,
        line: ref.line,
        snippet,
        inDegree: 0,
        outDegree: 0,
      });
      addEdge(from, to, 'code-mention');
    }
  }

  for (const edge of edges.values()) {
    const source = nodes.get(edge.from);
    const target = nodes.get(edge.to);
    if (source) source.outDegree += edge.weight;
    if (target) target.inDegree += edge.weight;
  }

  return {
    generation,
    nodes: [...nodes.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    edges: [...edges.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
  };
}
