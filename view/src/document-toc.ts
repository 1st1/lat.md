export function activeDocumentTocId(
  ids: readonly string[],
  tops: ReadonlyMap<string, number>,
  threshold = 96,
): string {
  let active = ids[0] ?? '';
  for (const id of ids) {
    const top = tops.get(id);
    if (top === undefined) continue;
    if (top > threshold) break;
    active = id;
  }
  return active;
}

export function documentTocIndentationDepth(
  depth: number,
  minimumSubsectionDepth: number,
): number {
  return depth === 1 ? 0 : Math.max(0, depth - minimumSubsectionDepth);
}

export function documentTocActivationLine({
  scrollTop,
  viewportHeight,
  scrollHeight,
  topOffset = 96,
}: {
  scrollTop: number;
  viewportHeight: number;
  scrollHeight: number;
  topOffset?: number;
}): number {
  const offset = Math.max(0, Math.min(topOffset, viewportHeight));
  const maximumScrollTop = Math.max(0, scrollHeight - viewportHeight);
  if (scrollTop <= 0 || maximumScrollTop === 0) return offset;

  const remainingScroll = Math.max(0, maximumScrollTop - scrollTop);
  const bottomTravel = Math.max(0, viewportHeight - offset);

  // Near the end of the document, move the activation line down through the
  // viewport so every short final section can cross it before scrolling stops.
  return offset + Math.max(0, bottomTravel - remainingScroll);
}

export function centeredDocumentTocScrollTop({
  containerHeight,
  contentHeight,
  itemHeight,
  itemTop,
}: {
  containerHeight: number;
  contentHeight: number;
  itemHeight: number;
  itemTop: number;
}): number {
  const centered = itemTop + itemHeight / 2 - containerHeight / 2;
  return Math.max(0, Math.min(centered, contentHeight - containerHeight));
}
