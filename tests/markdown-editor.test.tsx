// @vitest-environment jsdom

import { EditorView } from '@codemirror/view';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchViewDocumentSource, updateViewDocument } = vi.hoisted(() => ({
  fetchViewDocumentSource: vi.fn(),
  updateViewDocument: vi.fn(),
}));

vi.mock('../view/src/data-source.js', () => ({
  fetchViewDocumentSource,
  updateViewDocument,
}));

import { DocumentModeSwitch } from '../view/src/DocumentModeSwitch.js';
import { MarkdownEditor } from '../view/src/MarkdownEditor.js';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.assign(Range.prototype, {
  getBoundingClientRect: () => new DOMRect(),
  getClientRects: () => [] as unknown as DOMRectList,
});

function mountedEditor(container: HTMLElement): EditorView {
  const element = container.querySelector<HTMLElement>('.cm-editor');
  const view = element ? EditorView.findFromDOM(element) : null;
  if (!view) throw new Error('Expected a mounted CodeMirror editor');
  return view;
}

function replaceEditorContent(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

describe('MarkdownEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchViewDocumentSource.mockReset();
    updateViewDocument.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('switches presentation and saves the loaded Markdown source explicitly', async () => {
    const original = '# Guide\n\nOriginal.\n';
    const edited = '# Guide\n\nEdited.\n';
    fetchViewDocumentSource.mockResolvedValue({
      path: 'guide.md',
      content: original,
    });
    const onDirtyChange = vi.fn();
    updateViewDocument.mockResolvedValue({
      path: 'guide.md',
      content: edited,
      merged: false,
    });
    const onModeChange = vi.fn();

    await act(async () => {
      root.render(
        createElement(
          'div',
          null,
          createElement(DocumentModeSwitch, {
            mode: 'edit',
            onChange: onModeChange,
          }),
          createElement(MarkdownEditor, {
            active: true,
            onDirtyChange,
            path: 'guide.md',
            revision: 0,
          }),
        ),
      );
    });

    const modeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.document-mode-switch button',
      ),
    );
    expect(modeButtons.map((button) => button.textContent)).toEqual([
      'view',
      'edit',
    ]);
    expect(modeButtons[1].getAttribute('aria-pressed')).toBe('true');
    expect(modeButtons[0].querySelector('svg')).toBeNull();
    expect(modeButtons[1].querySelector('svg')).not.toBeNull();
    await act(async () => modeButtons[0].click());
    expect(onModeChange).toHaveBeenCalledWith('view');

    const editor = mountedEditor(container);
    expect(editor.state.doc.toString()).toBe(original);
    expect(editor.contentDOM.getAttribute('aria-label')).toBe(
      'Markdown source for guide.md',
    );
    expect(editor.contentDOM.classList.contains('cm-lineWrapping')).toBe(true);
    await act(async () => {
      replaceEditorContent(editor, edited);
    });
    expect(
      container.querySelector('.cm-editor-diff-marker-modified'),
    ).not.toBeNull();
    expect(
      container.querySelector('.cm-editor-diff-line-modified'),
    ).not.toBeNull();
    expect(
      container.querySelector('.markdown-editor-status span')?.textContent,
    ).toBe('Unsaved changes');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      editor.contentDOM.dispatchEvent(
        new FocusEvent('blur', { bubbles: true }),
      );
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(updateViewDocument).not.toHaveBeenCalled();

    const save = container.querySelector<HTMLButtonElement>(
      '.markdown-editor-status button',
    );
    expect(save?.disabled).toBe(false);
    await act(async () => save?.click());
    expect(updateViewDocument).toHaveBeenCalledWith('guide.md', {
      baseContent: original,
      content: edited,
    });
    expect(
      container.querySelector('.markdown-editor-status span')?.textContent,
    ).toBe('Saved');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(save?.disabled).toBe(true);
    expect(
      container.querySelector('.cm-editor-diff-marker-modified'),
    ).toBeNull();
  });

  it('leaves edits made during a save pending for another explicit save', async () => {
    const original = '# Guide\n\nOriginal.\n';
    const firstEdit = '# Guide\n\nFirst edit.\n';
    const secondEdit = '# Guide\n\nSecond edit.\n';
    let resolveFirst!: (value: {
      path: string;
      content: string;
      merged: boolean;
    }) => void;
    fetchViewDocumentSource.mockResolvedValue({
      path: 'guide.md',
      content: original,
    });
    updateViewDocument
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        path: 'guide.md',
        content: secondEdit,
        merged: false,
      });

    await act(async () => {
      root.render(
        createElement(MarkdownEditor, {
          active: true,
          path: 'guide.md',
          revision: 0,
        }),
      );
    });
    const editor = mountedEditor(container);
    await act(async () => replaceEditorContent(editor, firstEdit));
    const save = container.querySelector<HTMLButtonElement>(
      '.markdown-editor-status button',
    );
    await act(async () => save?.click());
    expect(updateViewDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      replaceEditorContent(editor, secondEdit);
      resolveFirst({
        path: 'guide.md',
        content: firstEdit,
        merged: false,
      });
      await Promise.resolve();
    });

    expect(updateViewDocument).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('.markdown-editor-status span')?.textContent,
    ).toBe('Unsaved changes');
    expect(
      container.querySelector('.cm-editor-diff-marker-modified'),
    ).not.toBeNull();

    await act(async () => save?.click());
    expect(updateViewDocument).toHaveBeenNthCalledWith(2, 'guide.md', {
      baseContent: firstEdit,
      content: secondEdit,
    });
    expect(editor.state.doc.toString()).toBe(secondEdit);
  });

  it('flushes with the save shortcut', async () => {
    const original = '# Guide\n\nOriginal.\n';
    const edited = '# Guide\n\nSave now.\n';
    fetchViewDocumentSource.mockResolvedValue({
      path: 'guide.md',
      content: original,
    });
    updateViewDocument.mockResolvedValue({
      path: 'guide.md',
      content: edited,
      merged: false,
    });

    await act(async () => {
      root.render(
        createElement(MarkdownEditor, {
          active: true,
          path: 'guide.md',
          revision: 0,
        }),
      );
    });
    const editor = mountedEditor(container);
    await act(async () => {
      replaceEditorContent(editor, edited);
      editor.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 's',
        }),
      );
      await Promise.resolve();
    });

    expect(updateViewDocument).toHaveBeenCalledWith('guide.md', {
      baseContent: original,
      content: edited,
    });
  });

  it('keeps a conflicting draft visible', async () => {
    const original = '# Guide\n\nOriginal.\n';
    const edited = '# Guide\n\nBrowser edit.\n';
    fetchViewDocumentSource.mockResolvedValue({
      path: 'guide.md',
      content: original,
    });
    updateViewDocument.mockRejectedValue(
      new Error(
        'Could not save because this file changed in the same area. Your edits are still in the editor.',
      ),
    );

    await act(async () => {
      root.render(
        createElement(MarkdownEditor, {
          active: true,
          path: 'guide.md',
          revision: 0,
        }),
      );
    });
    const editor = mountedEditor(container);
    await act(async () => replaceEditorContent(editor, edited));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('.markdown-editor-status button')
        ?.click(),
    );

    expect(editor.state.doc.toString()).toBe(edited);
    expect(
      container.querySelector('.markdown-editor-status span')?.textContent,
    ).toContain('Your edits are still in the editor');
    expect(
      container
        .querySelector('.markdown-editor-status')
        ?.getAttribute('data-state'),
    ).toBe('error');
  });

  it('reloads a deferred disk update after the draft returns to clean', async () => {
    const original = '# Guide\n\nOriginal.\n';
    const edited = '# Guide\n\nBrowser edit.\n';
    const external = '# Guide\n\nExternal edit.\n';
    fetchViewDocumentSource
      .mockResolvedValueOnce({ path: 'guide.md', content: original })
      .mockResolvedValueOnce({ path: 'guide.md', content: external });

    await act(async () => {
      root.render(
        createElement(MarkdownEditor, {
          active: true,
          path: 'guide.md',
          revision: 0,
        }),
      );
    });
    const editor = mountedEditor(container);
    await act(async () => replaceEditorContent(editor, edited));
    await act(async () => {
      root.render(
        createElement(MarkdownEditor, {
          active: true,
          path: 'guide.md',
          revision: 1,
        }),
      );
    });
    expect(fetchViewDocumentSource).toHaveBeenCalledTimes(1);

    await act(async () => replaceEditorContent(editor, original));

    expect(fetchViewDocumentSource).toHaveBeenCalledTimes(2);
    expect(editor.state.doc.toString()).toBe(external);
    expect(
      container.querySelector(
        '.cm-editor-diff-marker-added, .cm-editor-diff-marker-modified, .cm-editor-diff-marker-deleted',
      ),
    ).toBeNull();
  });
});
