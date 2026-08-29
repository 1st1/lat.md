import { existsSync } from 'node:fs';
import { extname, relative, resolve, dirname } from 'node:path';
import { ambiguousRefMessage, sourceRefError } from '../cli/check.js';
import {
  buildFileIndex,
  buildSectionSlugIndex,
  flattenSections,
  resolveRef,
  type Section,
} from '../lattice.js';
import { clearSymbolCache } from '../source-parser.js';
import type { ExternalResolver } from '../external-sources.js';
import { toPosix } from '../walk.js';
import { parseLocalMarkdownTarget } from '../markdown-validation.js';
import type { ViewDocumentError } from './protocol.js';
import type {
  ViewCodeReferenceFile,
  ViewParsedMarkdownFile,
} from './references.js';

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
  const target = parseLocalMarkdownTarget(link.url);
  if (target === null) return null;
  if (target.kind === 'invalid-backslash') return null;

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
  external?: ExternalResolver,
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

  if (external) {
    const root = files.find((file) => file.path === 'lat.md') ?? files[0];
    if (root) {
      for (const configError of external.snapshot.errors) {
        addError(
          errors,
          root.path,
          error(1, 'external-sources', configError.message, {
            marker: 'line',
          }),
        );
      }
    }
  }

  for (const file of files) {
    for (const diagnostic of file.diagnostics) {
      addError(
        errors,
        file.path,
        error(diagnostic.line, diagnostic.target, diagnostic.message, {
          anchor: diagnostic.anchor,
          marker: diagnostic.marker,
        }),
      );
    }

    for (const ref of file.wikiRefs) {
      if (external) {
        try {
          if (external.parse(ref.target)) {
            await external.resolve(ref.target);
            continue;
          }
        } catch (externalError) {
          addError(
            errors,
            file.path,
            error(ref.line, ref.target, (externalError as Error).message),
          );
          continue;
        }
        const unknownExternal = external.unknownTargetMessage(ref.target);
        if (unknownExternal) {
          addError(
            errors,
            file.path,
            error(ref.line, ref.target, unknownExternal),
          );
          continue;
        }
      }
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
      if (!('identifier' in link) && link.kind !== 'definition') {
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
    if (!file.frontmatter.requireCodeMention) continue;
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
