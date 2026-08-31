import type { Root, RootContent } from 'mdast';
import { flattenSections, type Section } from '../lattice-model.js';
import type { ViewDocumentError, ViewDocumentTocItem } from './protocol.js';

type StateNode = RootContent & {
  data?: { hProperties?: { className?: unknown } };
};

export type ViewTableOfContentsOptions = {
  errors?: readonly ViewDocumentError[];
  gitTree?: Root | null;
};

function sectionAtLine(sections: Section[], line: number): Section | null {
  let owner: Section | null = null;
  for (const section of sections) {
    if (line < section.startLine || line > section.endLine) continue;
    if (!owner || section.depth >= owner.depth) owner = section;
  }
  return owner;
}

function classNames(node: StateNode): string[] {
  const value = node.data?.hProperties?.className;
  if (Array.isArray(value)) return value.map(String);
  return value ? [String(value)] : [];
}

function hasGitChanges(node: RootContent): boolean {
  if (classNames(node as StateNode).some((name) => name.startsWith('git-'))) {
    return true;
  }
  if (!('children' in node) || !Array.isArray(node.children)) return false;
  return node.children.some((child) => hasGitChanges(child as RootContent));
}

function gitChangedSections(
  sections: Section[],
  tree: Root | null | undefined,
): Set<string> {
  const changed = new Set<string>();
  if (!tree) return changed;

  const headingStack: Section[] = [];
  const rootSection = sections[0] ?? null;
  for (const node of tree.children) {
    if (node.type === 'heading') {
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].depth >= node.depth
      ) {
        headingStack.pop();
      }
      const line = node.position?.start.line;
      const section = line
        ? (sections.find(
            (candidate) =>
              candidate.startLine === line && candidate.depth === node.depth,
          ) ?? null)
        : null;
      if (section) headingStack.push(section);
      if (hasGitChanges(node)) {
        const owner =
          section ?? headingStack[headingStack.length - 1] ?? rootSection;
        if (owner) changed.add(owner.id);
      }
      continue;
    }
    if (!hasGitChanges(node)) continue;
    const line = node.position?.start.line;
    const owner =
      (line ? sectionAtLine(sections, line) : null) ??
      headingStack[headingStack.length - 1] ??
      rootSection;
    if (owner) changed.add(owner.id);
  }
  return changed;
}

/** Project rendered headings into the document's local navigation. */
export function buildViewTableOfContents(
  sections: Section[],
  titles: readonly string[],
  options: ViewTableOfContentsOptions = {},
): ViewDocumentTocItem[] {
  const flatSections = flattenSections(sections);
  const errorCounts = new Map<string, number>();
  for (const error of options.errors ?? []) {
    const owner = sectionAtLine(flatSections, error.line);
    if (owner) errorCounts.set(owner.id, (errorCounts.get(owner.id) ?? 0) + 1);
  }
  const gitChanges = gitChangedSections(flatSections, options.gitTree);

  return flatSections.flatMap((section, index) =>
    section.githubSlug
      ? [
          {
            id: section.githubSlug,
            title: titles[index] || section.heading,
            depth: section.depth,
            errorCount: errorCounts.get(section.id) ?? 0,
            hasGitChanges: gitChanges.has(section.id),
          },
        ]
      : [],
  );
}
