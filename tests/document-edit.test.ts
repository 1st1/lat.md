import { describe, expect, it } from 'vitest';
import {
  applyDocumentEdit,
  ViewDocumentConflictError,
} from '../src/view/document-edit.js';

describe('document edit patches', () => {
  it('applies an edit directly when the file is unchanged', () => {
    expect(
      applyDocumentEdit('one\ntwo\n', 'one\nchanged\n', 'one\ntwo\n'),
    ).toEqual({
      content: 'one\nchanged\n',
      merged: false,
    });
  });

  it('preserves concurrent changes outside the edited hunk', () => {
    const base =
      '# Guide\n\nIntro.\n\n## First\n\nOld first.\n\n## Second\n\nOld second.\n';
    const edited = base.replace('Old first.', 'Edited first.');
    const current = base.replace('Old second.', 'Concurrent second.');

    expect(applyDocumentEdit(base, edited, current)).toEqual({
      content: edited.replace('Old second.', 'Concurrent second.'),
      merged: true,
    });
  });

  it('rejects edits that overlap a concurrent change', () => {
    const base = '# Guide\n\nOriginal paragraph.\n';
    expect(() =>
      applyDocumentEdit(
        base,
        '# Guide\n\nUser paragraph.\n',
        '# Guide\n\nConcurrent paragraph.\n',
      ),
    ).toThrow(ViewDocumentConflictError);
  });

  it('accepts an already-applied edit as an idempotent retry', () => {
    expect(applyDocumentEdit('old\n', 'new\n', 'new\n')).toEqual({
      content: 'new\n',
      merged: true,
    });
  });
});
