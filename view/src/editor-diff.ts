import { Chunk } from '@codemirror/merge';
import {
  RangeSet,
  StateEffect,
  StateField,
  Text,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  type DecorationSet,
} from '@codemirror/view';

type EditorDiffKind = 'added' | 'modified' | 'deleted';

type EditorDiffState = {
  original: Text;
  chunks: readonly Chunk[];
  markers: RangeSet<GutterMarker>;
  decorations: DecorationSet;
};

const DIFF_CONFIG = { scanLimit: 500, timeout: 50 } as const;

class EditorDiffMarker extends GutterMarker {
  constructor(readonly kind: EditorDiffKind | 'spacer') {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof EditorDiffMarker && other.kind === this.kind;
  }

  override toDOM(): HTMLElement {
    const marker = document.createElement('span');
    marker.className = `cm-editor-diff-marker cm-editor-diff-marker-${this.kind}`;
    if (this.kind !== 'spacer') {
      marker.title = `${this.kind[0].toUpperCase()}${this.kind.slice(1)} since opening the editor`;
    }
    return marker;
  }
}

const diffMarkers = {
  added: new EditorDiffMarker('added'),
  modified: new EditorDiffMarker('modified'),
  deleted: new EditorDiffMarker('deleted'),
} as const;
const spacerMarker = new EditorDiffMarker('spacer');

function text(source: string): Text {
  return Text.of(source.split(/\r\n?|\n/));
}

function strongerKind(
  previous: EditorDiffKind | undefined,
  next: EditorDiffKind,
): EditorDiffKind {
  if (!previous || previous === next) return next;
  return 'modified';
}

function presentDiff(
  original: Text,
  current: Text,
  chunks: readonly Chunk[],
): EditorDiffState {
  const changedLines = new Map<number, EditorDiffKind>();
  for (const chunk of chunks) {
    const kind: EditorDiffKind =
      chunk.fromB === chunk.toB
        ? 'deleted'
        : chunk.fromA === chunk.toA
          ? 'added'
          : 'modified';
    const firstLine = current.lineAt(Math.min(chunk.fromB, current.length));
    if (kind === 'deleted') {
      changedLines.set(
        firstLine.from,
        strongerKind(changedLines.get(firstLine.from), kind),
      );
      continue;
    }
    const lastLine = current.lineAt(Math.min(chunk.endB, current.length));
    for (let number = firstLine.number; number <= lastLine.number; number++) {
      const position = current.line(number).from;
      changedLines.set(
        position,
        strongerKind(changedLines.get(position), kind),
      );
    }
  }

  const markers = [...changedLines]
    .sort(([left], [right]) => left - right)
    .map(([position, kind]) => diffMarkers[kind].range(position));
  const decorations = [...changedLines]
    .filter(([, kind]) => kind !== 'deleted')
    .sort(([left], [right]) => left - right)
    .map(([position, kind]) =>
      Decoration.line({
        class: `cm-editor-diff-line cm-editor-diff-line-${kind}`,
      }).range(position),
    );
  return {
    original,
    chunks,
    markers: RangeSet.of(markers),
    decorations: Decoration.set(decorations),
  };
}

export const setEditorDiffOriginal = StateEffect.define<string>();

export function editorDiff(originalSource: string): Extension {
  const initialOriginal = text(originalSource);
  return StateField.define<EditorDiffState>({
    create(state) {
      const chunks = Chunk.build(initialOriginal, state.doc, DIFF_CONFIG);
      return presentDiff(initialOriginal, state.doc, chunks);
    },
    update(value, transaction) {
      const replacement = transaction.effects.find((effect) =>
        effect.is(setEditorDiffOriginal),
      );
      if (replacement) {
        const original = text(replacement.value);
        return presentDiff(
          original,
          transaction.state.doc,
          Chunk.build(original, transaction.state.doc, DIFF_CONFIG),
        );
      }
      if (!transaction.docChanged) return value;
      const chunks = Chunk.updateB(
        value.chunks,
        value.original,
        transaction.state.doc,
        transaction.changes,
        DIFF_CONFIG,
      );
      return presentDiff(value.original, transaction.state.doc, chunks);
    },
    provide: (field) => [
      gutter({
        class: 'cm-editorDiffGutter',
        initialSpacer: () => spacerMarker,
        markers: (view) => view.state.field(field).markers,
      }),
      EditorView.decorations.from(
        field,
        (value: EditorDiffState) => value.decorations,
      ),
    ],
  });
}
