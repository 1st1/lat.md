/** Normalize path separators for stable project-relative identities. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}
