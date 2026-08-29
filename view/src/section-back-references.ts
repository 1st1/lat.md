type ClipboardWriter = Pick<Clipboard, 'writeText'>;

/** Copy the canonical ID accepted by `lat section`. */
export function copySectionId(
  sectionId: string,
  clipboard?: ClipboardWriter,
): string {
  if (clipboard) void clipboard.writeText(sectionId).catch(() => {});
  return sectionId;
}

/** Build the live endpoint that runs `lat section` for one canonical ID. */
export function sectionOutputRequestUrl(sectionId: string): string {
  return `/api/section?query=${encodeURIComponent(sectionId)}`;
}

/** Navigate to one rendered section and copy its absolute browser URL. */
export function navigateAndCopySectionLink(
  currentHref: string,
  headingId: string,
  navigate: (url: URL) => void,
  clipboard?: ClipboardWriter,
): URL {
  const url = new URL(currentHref);
  url.hash = headingId;
  navigate(url);
  if (clipboard) void clipboard.writeText(url.href).catch(() => {});
  return url;
}
