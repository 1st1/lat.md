import { dirname, relative, resolve } from 'node:path';
import type { SectionMatch } from '../lattice-model.js';
import { toPosix } from '../path.js';
import type { ViewSearchResult } from './protocol.js';
import { documentUrl } from './document-route.js';

/** Convert one graph section match into the browser search protocol. */
export function viewSearchResult(
  latDir: string,
  match: SectionMatch,
  documentPaths?: ReadonlyMap<string, string>,
): ViewSearchResult {
  const section = match.section;
  const projectRoot = dirname(latDir);
  const path =
    documentPaths?.get(section.id.toLowerCase()) ??
    toPosix(relative(latDir, resolve(projectRoot, section.filePath)));
  const fileBreadcrumbs = path.replace(/\.md$/i, '').split('/');
  return {
    sectionId: section.id,
    title: section.heading,
    path,
    breadcrumbs: [...fileBreadcrumbs, ...section.id.split('#').slice(1)],
    description: section.firstParagraph,
    url: documentUrl(path, section.githubSlug ?? ''),
    score: match.score ?? 0,
  };
}
