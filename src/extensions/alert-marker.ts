import type { Data, Literal, Parents, PhrasingContent, Root } from 'mdast';
import type { Info, Options, State } from 'mdast-util-to-markdown';
import { visit } from 'unist-util-visit';

export const ALERT_KINDS = [
  'NOTE',
  'TIP',
  'IMPORTANT',
  'WARNING',
  'CAUTION',
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export interface AlertMarker extends Literal {
  type: 'alertMarker';
  value: AlertKind;
  data?: Data;
}

const ALERT_PATTERN = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/;

/** Promote GitHub alert markers so serialization does not escape their brackets. */
export function markAlertMarkers(tree: Root): void {
  visit(tree, 'blockquote', (node) => {
    const firstBlock = node.children[0];
    if (firstBlock?.type !== 'paragraph') return;
    const firstInline = firstBlock.children[0];
    if (firstInline?.type !== 'text') return;
    const match = firstInline.value.match(ALERT_PATTERN);
    if (!match) return;

    const marker: AlertMarker = {
      type: 'alertMarker',
      value: match[1] as AlertKind,
    };
    const start = firstInline.position?.start;
    if (start) {
      const markerLength = match[0].replace(/\r?\n$/, '').length;
      marker.position = {
        start,
        end: {
          line: start.line,
          column: start.column + markerLength,
          ...(start.offset === undefined
            ? {}
            : { offset: start.offset + markerLength }),
        },
      };
    }
    const remaining = firstInline.value.slice(match[0].length);
    const replacement: PhrasingContent[] = [marker];
    if (remaining !== '') replacement.push({ type: 'text', value: remaining });
    firstBlock.children.splice(0, 1, ...replacement);
  });
}

function alertMarkerHandler(
  node: AlertMarker,
  _parent: Parents | undefined,
  state: State,
  _info: Info,
): string {
  const exit = state.enter('alertMarker');
  const value = `[!${node.value}]\n`;
  exit();
  return value;
}

export function alertMarkerToMarkdown(): Options {
  return { handlers: { alertMarker: alertMarkerHandler } };
}

declare module 'mdast' {
  interface RootContentMap {
    alertMarker: AlertMarker;
  }

  interface PhrasingContentMap {
    alertMarker: AlertMarker;
  }
}

declare module 'mdast-util-to-markdown' {
  interface ConstructNameMap {
    alertMarker: 'alertMarker';
  }
}
