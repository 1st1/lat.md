import { flattenSections, type MdLink, type Section } from './lattice-model.js';

export const MAX_SECTION_SUMMARY_LENGTH = 250;

export type LocalMarkdownDiagnostic = {
  rule:
    | 'markdown-reference-definition'
    | 'markdown-path-separator'
    | 'section-leading-paragraph';
  line: number;
  target: string;
  message: string;
  anchor?: string;
  marker?: 'target' | 'line' | 'heading';
};

export type LocalMarkdownTarget =
  | {
      kind: 'target';
      /** Decoded on-disk path, or null for a fragment in the current file. */
      path: string | null;
      /** Decoded fragment without `#`, or null when none was authored. */
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

/** Parse a local Markdown destination without confusing escaped #/? in paths. */
export function parseLocalMarkdownTarget(
  url: string,
): LocalMarkdownTarget | null {
  const value = url.trim();
  if (value.startsWith('/')) return null;
  const windowsDrivePath = /^[a-zA-Z]:\\/.test(value);
  if (!windowsDrivePath && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return null;
  }

  // Split before decoding: `%23` and `%3F` decode to `#` and `?`, which would
  // then truncate a filename that legitimately contains them.
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

/** Count summary text while excluding `[[...]]` markers and link content. */
export function sectionSummaryLength(body: string): number {
  return body.replace(/\[\[[^\]]*\]\]/g, '').length;
}

/** Validate rules that need no facts outside one parsed Markdown file. */
export function analyzeLocalMarkdownDiagnostics(
  links: readonly MdLink[],
  sections: readonly Section[],
): LocalMarkdownDiagnostic[] {
  const diagnostics: LocalMarkdownDiagnostic[] = [];

  for (const link of links) {
    if ('identifier' in link) {
      const kind = link.kind === 'imageReference' ? 'image' : 'link';
      const renderedKind = kind === 'image' ? 'an image' : 'a link';
      const escapedSource = link.source.replace('[', '\\[');
      diagnostics.push({
        rule: 'markdown-reference-definition',
        line: link.line,
        target: link.identifier,
        message:
          link.style === 'definition'
            ? `malformed reference definition (${link.source}) — ` +
              `write it as "[${link.identifier}]: <destination>" on its own line, ` +
              `or escape the opening bracket as "${escapedSource}" to keep it as literal text`
            : link.style === 'shortcut'
              ? `undefined shortcut ${kind} reference (${link.source}) — ` +
                `add a definition "[${link.identifier}]: <destination>" to make it ${renderedKind}, ` +
                `or escape the opening bracket as "${escapedSource}" to keep it as literal text`
              : `undefined ${kind} reference (${link.source}) — definition "[${link.identifier}]" not found`,
        marker: 'line',
      });
      continue;
    }

    if (parseLocalMarkdownTarget(link.url)?.kind === 'invalid-backslash') {
      const kind = link.kind === 'image' ? 'image' : 'link';
      diagnostics.push({
        rule: 'markdown-path-separator',
        line: link.line,
        target: link.url,
        message:
          `invalid ${kind} (${link.url}) — backslashes are not path ` +
          'separators in Markdown; use "/" instead',
      });
    }
  }

  for (const section of flattenSections([...sections])) {
    if (!section.firstParagraph) {
      diagnostics.push({
        rule: 'section-leading-paragraph',
        line: section.startLine,
        target: section.id,
        message:
          `section "${section.id}" has no leading paragraph. ` +
          `Every section must start with a brief overview (≤${MAX_SECTION_SUMMARY_LENGTH} chars) ` +
          `summarizing what it documents — this powers search snippets and command output.`,
        anchor: section.githubSlug,
        marker: 'heading',
      });
      continue;
    }

    const length = sectionSummaryLength(section.firstParagraph);
    if (length > MAX_SECTION_SUMMARY_LENGTH) {
      diagnostics.push({
        rule: 'section-leading-paragraph',
        line: section.startLine,
        target: section.id,
        message:
          `section "${section.id}" leading paragraph is ${length} characters ` +
          `(max ${MAX_SECTION_SUMMARY_LENGTH}, excluding [[wiki links]]). ` +
          `Keep the first paragraph brief — it serves as the section's summary ` +
          `in search results and command output. Use subsequent paragraphs for details.`,
        anchor: section.githubSlug,
        marker: 'heading',
      });
    }
  }

  return diagnostics;
}
