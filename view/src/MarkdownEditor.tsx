import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState, Transaction } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchViewDocumentSource, updateViewDocument } from './data-source';
import { editorDiff, setEditorDiffOriginal } from './editor-diff';

type EditorStatus = {
  kind: 'loading' | 'dirty' | 'saving' | 'saved' | 'error';
  message: string;
};

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--syntax-markup)', fontWeight: '700' },
  { tag: [tags.link, tags.url], color: 'var(--syntax-string)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  {
    tag: tags.keyword,
    color: 'var(--syntax-keyword)',
  },
  { tag: [tags.string, tags.inserted], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.atom, tags.bool], color: 'var(--syntax-number)' },
  { tag: tags.function(tags.variableName), color: 'var(--syntax-title)' },
  { tag: tags.typeName, color: 'var(--syntax-title)' },
  {
    tag: [tags.variableName, tags.propertyName, tags.attributeName],
    color: 'var(--text)',
  },
  { tag: tags.punctuation, color: 'var(--text)' },
  { tag: [tags.comment, tags.quote], color: 'var(--syntax-comment)' },
  { tag: [tags.monospace, tags.processingInstruction], color: 'var(--muted)' },
  { tag: tags.invalid, color: 'var(--danger)' },
]);

export function MarkdownEditor({
  active,
  onDirtyChange,
  path,
  revision,
}: {
  active: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  path: string;
  revision: number;
}) {
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [loadRevision, setLoadRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<EditorStatus>({
    kind: 'loading',
    message: 'Loading source…',
  });
  const baseContent = useRef<string | null>(null);
  const draftContent = useRef<string | null>(null);
  const saveInFlight = useRef(false);
  const mounted = useRef(true);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const editorHost = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const applyingServerContent = useRef(false);
  const loadedRevision = useRef(revision);

  const setVisibleStatus = useCallback((next: EditorStatus) => {
    if (mounted.current) setStatus(next);
  }, []);

  const setVisibleDirty = useCallback((next: boolean) => {
    if (mounted.current) setDirty(next);
    onDirtyChangeRef.current?.(next);
  }, []);

  const replaceEditorContent = useCallback(
    (content: string, resetDiff = false) => {
      const view = editorView.current;
      if (!view) return;
      const changed = view.state.doc.toString() !== content;
      if (!changed && !resetDiff) return;
      applyingServerContent.current = true;
      try {
        view.dispatch({
          changes: changed
            ? { from: 0, to: view.state.doc.length, insert: content }
            : undefined,
          effects: resetDiff ? setEditorDiffOriginal.of(content) : undefined,
          annotations: Transaction.addToHistory.of(false),
        });
      } finally {
        applyingServerContent.current = false;
      }
    },
    [],
  );

  const resetDiffOriginal = useCallback((content: string) => {
    editorView.current?.dispatch({
      effects: setEditorDiffOriginal.of(content),
      annotations: Transaction.addToHistory.of(false),
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (saveInFlight.current) return;
    if (
      baseContent.current === null ||
      draftContent.current === null ||
      baseContent.current === draftContent.current
    ) {
      return;
    }
    saveInFlight.current = true;
    const sentBase = baseContent.current;
    const sentContent = draftContent.current;
    setVisibleStatus({ kind: 'saving', message: 'Saving…' });
    try {
      const result = await updateViewDocument(path, {
        baseContent: sentBase,
        content: sentContent,
      });
      if (draftContent.current === sentContent) {
        baseContent.current = result.content;
        draftContent.current = result.content;
        replaceEditorContent(result.content, true);
        setVisibleDirty(false);
        setVisibleStatus({
          kind: 'saved',
          message: result.merged ? 'Saved with newer disk changes' : 'Saved',
        });
      } else {
        // The submitted source is now the base for the remaining local delta.
        // A later explicit save applies that delta to the latest disk content.
        baseContent.current = sentContent;
        resetDiffOriginal(sentContent);
        setVisibleDirty(true);
        setVisibleStatus({ kind: 'dirty', message: 'Unsaved changes' });
      }
    } catch (reason) {
      setVisibleDirty(true);
      setVisibleStatus({
        kind: 'error',
        message: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      saveInFlight.current = false;
    }
  }, [
    path,
    replaceEditorContent,
    resetDiffOriginal,
    setVisibleDirty,
    setVisibleStatus,
  ]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || sourceLoaded) return;
    const controller = new AbortController();
    setStatus({ kind: 'loading', message: 'Loading source…' });
    void fetchViewDocumentSource(path, controller.signal)
      .then((source) => {
        baseContent.current = source.content;
        draftContent.current = source.content;
        setSourceLoaded(true);
        setVisibleDirty(false);
        setStatus({ kind: 'saved', message: 'Saved' });
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setStatus({
          kind: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
        });
      });
    return () => controller.abort();
  }, [active, loadRevision, path, setVisibleDirty, sourceLoaded]);

  useEffect(() => {
    if (!sourceLoaded || revision === loadedRevision.current) return;
    if (saveInFlight.current || baseContent.current !== draftContent.current) {
      return;
    }
    loadedRevision.current = revision;
    if (!active) {
      baseContent.current = null;
      draftContent.current = null;
      setSourceLoaded(false);
      return;
    }
    const controller = new AbortController();
    void fetchViewDocumentSource(path, controller.signal)
      .then((source) => {
        baseContent.current = source.content;
        draftContent.current = source.content;
        replaceEditorContent(source.content, true);
        setSourceLoaded(true);
        setVisibleDirty(false);
        setStatus({ kind: 'saved', message: 'Saved' });
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setStatus({
          kind: 'error',
          message: reason instanceof Error ? reason.message : String(reason),
        });
      });
    return () => controller.abort();
  }, [
    active,
    path,
    replaceEditorContent,
    revision,
    setVisibleDirty,
    sourceLoaded,
    status.kind,
  ]);

  const updateContent = useCallback(
    (next: string): void => {
      draftContent.current = next;
      const nextDirty = saveInFlight.current || next !== baseContent.current;
      setVisibleDirty(nextDirty);
      if (!nextDirty) {
        setStatus({ kind: 'saved', message: 'Saved' });
        return;
      }
      setStatus({ kind: 'dirty', message: 'Unsaved changes' });
    },
    [setVisibleDirty],
  );

  useEffect(() => {
    if (!active || !sourceLoaded || !editorHost.current) return;
    const view = new EditorView({
      parent: editorHost.current,
      state: EditorState.create({
        doc: draftContent.current ?? '',
        extensions: [
          history(),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          drawSelection(),
          dropCursor(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(markdownHighlightStyle),
          editorDiff(draftContent.current ?? ''),
          EditorView.contentAttributes.of({
            'aria-label': `Markdown source for ${path}`,
            autocapitalize: 'off',
            autocomplete: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applyingServerContent.current) {
              updateContent(update.state.doc.toString());
            }
          }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                void saveDraft();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
        ],
      }),
    });
    editorView.current = view;
    view.focus();
    return () => {
      editorView.current = null;
      view.destroy();
    };
  }, [active, path, saveDraft, sourceLoaded, updateContent]);

  if (!active) return null;

  if (!sourceLoaded) {
    return (
      <div className="markdown-editor-state" data-state={status.kind}>
        <span>{status.message}</span>
        {status.kind === 'error' && (
          <button
            onClick={() => setLoadRevision((value) => value + 1)}
            type="button"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="markdown-editor" aria-label={`Editing ${path}`}>
      <div
        aria-live="polite"
        className="markdown-editor-status"
        data-state={status.kind}
      >
        <span>{status.message}</span>
        <button
          disabled={!dirty || status.kind === 'saving'}
          onClick={() => void saveDraft()}
          type="button"
        >
          Save
        </button>
      </div>
      <div className="markdown-editor-body">
        <div ref={editorHost} />
      </div>
    </section>
  );
}

export default MarkdownEditor;
