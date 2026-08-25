export const SOURCE_CONTEXT_BUFFER = 5;

export type SourceFocusRange = {
  startLine: number;
  endLine: number;
} | null;

export type SourceWindow = {
  startLine: number;
  endLine: number;
  hiddenAbove: number;
  hiddenBelow: number;
};

export type SourceWindowRow =
  | { kind: 'context' }
  | { kind: 'expand'; count: number; direction: 'above' | 'below' }
  | { kind: 'line'; focused: boolean; lineNumber: number };

export function getSourceWindow(
  totalLines: number,
  focus: SourceFocusRange,
  expandedAbove = false,
  expandedBelow = false,
): SourceWindow {
  if (!focus || totalLines < 1) {
    return {
      startLine: totalLines > 0 ? 1 : 0,
      endLine: totalLines,
      hiddenAbove: 0,
      hiddenBelow: 0,
    };
  }

  const focusStart = Math.max(1, Math.min(totalLines, focus.startLine));
  const focusEnd = Math.max(focusStart, Math.min(totalLines, focus.endLine));
  const startLine = expandedAbove
    ? 1
    : Math.max(1, focusStart - SOURCE_CONTEXT_BUFFER);
  const endLine = expandedBelow
    ? totalLines
    : Math.min(totalLines, focusEnd + SOURCE_CONTEXT_BUFFER);

  return {
    startLine,
    endLine,
    hiddenAbove: startLine - 1,
    hiddenBelow: totalLines - endLine,
  };
}

/** Build the interleaved rows rendered inside the source code panel. */
export function getSourceWindowRows(
  totalLines: number,
  focus: SourceFocusRange,
  hasContext: boolean,
  expandedAbove = false,
  expandedBelow = false,
): SourceWindowRow[] {
  const window = getSourceWindow(
    totalLines,
    focus,
    expandedAbove,
    expandedBelow,
  );
  const rows: SourceWindowRow[] = [];

  if (!focus && hasContext) rows.push({ kind: 'context' });
  if (window.hiddenAbove > 0) {
    rows.push({
      kind: 'expand',
      count: window.hiddenAbove,
      direction: 'above',
    });
  }
  for (
    let lineNumber = window.startLine;
    lineNumber <= window.endLine;
    lineNumber++
  ) {
    if (hasContext && lineNumber === focus?.startLine) {
      rows.push({ kind: 'context' });
    }
    rows.push({
      kind: 'line',
      focused: Boolean(
        focus && lineNumber >= focus.startLine && lineNumber <= focus.endLine,
      ),
      lineNumber,
    });
  }
  if (window.hiddenBelow > 0) {
    rows.push({
      kind: 'expand',
      count: window.hiddenBelow,
      direction: 'below',
    });
  }

  return rows;
}
