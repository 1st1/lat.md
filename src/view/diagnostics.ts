import { existsSync } from 'node:fs';
import { extname, relative, resolve, dirname } from 'node:path';
import { ambiguousRefMessage, sourceRefError } from '../cli/check.js';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  flattenSections,
  parseFrontmatter,
  resolveRef,
  type Section,
} from '../lattice.js';
import { clearSymbolCache } from '../source-parser.js';
import { toPosix } from '../walk.js';
import type { ViewDocumentError } from './protocol.js';
import type {
  ViewCodeReferenceFile,
  ViewParsedMarkdownFile,
} from './references.js';

const MAX_BODY_LENGTH = 250;

type LocalLinkTarget =
  | {
      kind: 'target';
      path: string | null;
      fragment: string | null;
    }
  | { kind: 'invalid-backslash' };

function decodeLinkPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function localLinkTarget(url: string): LocalLinkTarget | null {
  const value = url.trim();
  if (value.startsWith('/')) return null;
  const windowsDrivePath = /^[a-zA-Z]:\\/.test(value);
  if (!windowsDrivePath && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return null;
  }

  const queryAt = value.indexOf('?');
  const fragmentAt = value.indexOf('#');
  const pathEnd = Math.min(
    queryAt === -1 ? value.length : queryAt,
    fragmentAt === -1 ? value.length : fragmentAt,
  );
  const rawPath = value.slice(0, pathEnd);
  const path = rawPath === '' ? null : decodeLinkPart(rawPath);
  const fragment =
    fragmentAt === -1 ? null : decodeLinkPart(value.slice(fragmentAt + 1));
  if (rawPath === '' && fragment === null) return null;
  if (path?.includes('\\')) return { kind: 'invalid-backslash' };
  return { kind: 'target', path, fragment };
}

function bodyTextLength(body: string): number {
  return body.replace(/\[\[[^\]]*\]\]/g, '').length;
}

function error(
  line: number,
  target: string,
  message: string,
  options: {
    anchor?: string;
    marker?: ViewDocumentError['marker'];
  } = {},
): ViewDocumentError {
  return {
    anchor: options.anchor || `user-content-markdown-error-${line}`,
    line,
    marker: options.marker ?? 'target',
    message,
    target,
  };
}

function addError(
  errors: Map<string, ViewDocumentError[]>,
  path: string,
  diagnostic: ViewDocumentError,
): void {
  const fileErrors = errors.get(path) ?? [];
  const duplicate = fileErrors.some(
    (candidate) =>
      candidate.line === diagnostic.line &&
      candidate.message === diagnostic.message,
  );
  if (!duplicate) {
    let unique = diagnostic;
    if (
      diagnostic.marker === 'target' &&
      fileErrors.some((candidate) => candidate.anchor === diagnostic.anchor)
    ) {
      let suffix = 2;
      while (
        fileErrors.some(
          (candidate) => candidate.anchor === `${diagnostic.anchor}-${suffix}`,
        )
      ) {
        suffix++;
      }
      unique = { ...diagnostic, anchor: `${diagnostic.anchor}-${suffix}` };
    }
    fileErrors.push(unique);
  }
  errors.set(path, fileErrors);
}

async function markdownLinkError(
  file: ViewParsedMarkdownFile,
  filesByAbsolutePath: ReadonlyMap<string, ViewParsedMarkdownFile>,
  link: { kind: 'image' | 'link'; line: number; url: string },
  projectRoot: string,
): Promise<ViewDocumentError | null> {
  const target = localLinkTarget(link.url);
  if (target === null) return null;
  if (target.kind === 'invalid-backslash') {
    return error(
      link.line,
      link.url,
      `invalid ${link.kind} (${link.url}) — backslashes are not path separators in Markdown; use "/" instead`,
    );
  }

  const absolutePath = target.path
    ? resolve(dirname(file.absolutePath), target.path)
    : file.absolutePath;
  if (!existsSync(absolutePath)) {
    return error(
      link.line,
      link.url,
      `broken ${link.kind} (${link.url}) — file "${toPosix(relative(projectRoot, absolutePath))}" not found`,
    );
  }
  if (
    !target.fragment ||
    extname(absolutePath).toLowerCase() !== '.md' ||
    link.kind === 'image'
  ) {
    return null;
  }

  const destination = filesByAbsolutePath.get(resolve(absolutePath));
  if (!destination) return null;
  const headings = new Set(
    flattenSections(destination.sections).map((section) => section.githubSlug),
  );
  if (headings.has(target.fragment)) return null;
  return error(
    link.line,
    link.url,
    `broken link (${link.url}) — heading "#${target.fragment}" not found in "${destination.path}"`,
  );
}

/** Build per-document validation errors entirely from the current view snapshot. */
export async function buildViewDiagnostics(
  markdownFiles: Iterable<ViewParsedMarkdownFile>,
  codeFiles: Iterable<ViewCodeReferenceFile>,
  allSections: Section[],
  projectRoot: string,
): Promise<ReadonlyMap<string, readonly ViewDocumentError[]>> {
  clearSymbolCache();
  const files = [...markdownFiles];
  const errors = new Map<string, ViewDocumentError[]>();
  const sections = flattenSections(allSections);
  const sectionIds = new Set(
    sections.map((section) => section.id.toLowerCase()),
  );
  const fileIndex = buildFileIndex(allSections);
  const slugIndex = buildSectionSlugIndex(allSections);
  const filesByAbsolutePath = new Map(
    files.map((file) => [resolve(file.absolutePath), file]),
  );

  for (const file of files) {
    for (const ref of file.wikiRefs) {
      const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
      let message: string | null = null;
      if (resolved.ambiguous) {
        message = ambiguousRefMessage(
          ref.target,
          resolved.ambiguous,
          resolved.suggested,
        );
      } else if (!sectionIds.has(resolved.resolved.toLowerCase())) {
        message = await sourceRefError(ref.target, projectRoot);
      }
      if (message)
        addError(errors, file.path, error(ref.line, ref.target, message));
    }

    const links = new Map<
      string,
      { kind: 'image' | 'link'; line: number; url: string }
    >();
    for (const link of file.validationLinks) {
      if ('identifier' in link) {
        addError(
          errors,
          file.path,
          error(
            link.line,
            link.identifier,
            `undefined ${link.kind === 'imageReference' ? 'image' : 'link'} reference (${link.source}) — definition "[${link.identifier}]" not found`,
            { marker: 'line' },
          ),
        );
      } else if (link.kind !== 'definition') {
        links.set(`${link.kind}:${link.line}:${link.url}`, {
          kind: link.kind,
          line: link.line,
          url: link.url,
        });
      }
    }
    for (const link of file.markdownLinks) {
      links.set(`${link.kind}:${link.line}:${link.url}`, link);
    }
    for (const link of links.values()) {
      const diagnostic = await markdownLinkError(
        file,
        filesByAbsolutePath,
        link,
        projectRoot,
      );
      if (diagnostic) addError(errors, file.path, diagnostic);
    }

    for (const section of flattenSections(file.sections)) {
      if (!section.firstParagraph) {
        addError(
          errors,
          file.path,
          error(
            section.startLine,
            section.id,
            `section "${section.id}" has no leading paragraph. Every section must start with a brief overview (≤${MAX_BODY_LENGTH} chars).`,
            { anchor: section.githubSlug, marker: 'heading' },
          ),
        );
        continue;
      }
      const length = bodyTextLength(section.firstParagraph);
      if (length > MAX_BODY_LENGTH) {
        addError(
          errors,
          file.path,
          error(
            section.startLine,
            section.id,
            `section "${section.id}" leading paragraph is ${length} characters (max ${MAX_BODY_LENGTH}, excluding [[wiki links]]).`,
            { anchor: section.githubSlug, marker: 'heading' },
          ),
        );
      }
    }
  }

  const mentionedSections = new Set<string>();
  for (const file of codeFiles) {
    for (const ref of file.refs) {
      const resolved = resolveRef(ref.target, sectionIds, fileIndex, slugIndex);
      if (
        !resolved.ambiguous &&
        sectionIds.has(resolved.resolved.toLowerCase())
      ) {
        mentionedSections.add(resolved.resolved.toLowerCase());
      }
    }
  }
  for (const file of files) {
    if (!parseFrontmatter(file.content).requireCodeMention) continue;
    for (const section of flattenSections(file.sections)) {
      if (
        section.children.length === 0 &&
        !mentionedSections.has(section.id.toLowerCase())
      ) {
        addError(
          errors,
          file.path,
          error(
            section.startLine,
            section.id,
            `section "${section.id}" requires a code mention but none found`,
            { anchor: section.githubSlug, marker: 'heading' },
          ),
        );
      }
    }
  }

  return new Map(
    [...errors].map(([path, diagnostics]) => [
      path,
      diagnostics.sort(
        (left, right) =>
          left.line - right.line || left.message.localeCompare(right.message),
      ),
    ]),
  );
}
