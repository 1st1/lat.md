export type ScrollAnchor = {
  elementId: string;
  top: number;
};

type AnchorElement = {
  getBoundingClientRect: () => { top: number };
};

export type ScrollAnchorViewport = {
  getElementById: (id: string) => AnchorElement | null;
  scrollBy: (options: ScrollToOptions) => void;
};

/** Capture a rendered element's viewport position before prepending content. */
export function captureScrollAnchor(
  elementId: string,
  viewport: Pick<ScrollAnchorViewport, 'getElementById'>,
): ScrollAnchor | null {
  const element = viewport.getElementById(elementId);
  return element
    ? { elementId, top: element.getBoundingClientRect().top }
    : null;
}

/** Offset the window by an anchor's displacement after layout changes. */
export function restoreScrollAnchor(
  anchor: ScrollAnchor,
  viewport: ScrollAnchorViewport,
): void {
  const element = viewport.getElementById(anchor.elementId);
  if (!element) return;
  const adjustment = element.getBoundingClientRect().top - anchor.top;
  if (adjustment === 0) return;
  viewport.scrollBy({ top: adjustment, behavior: 'instant' });
}
