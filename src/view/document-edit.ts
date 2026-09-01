import { applyPatch, createPatch } from 'diff';

const PATCH_CONTEXT_LINES = 3;
const PATCH_FUZZ_LINES = 2;

export class ViewDocumentConflictError extends Error {}

export type AppliedDocumentEdit = {
  content: string;
  merged: boolean;
};

/** Apply the user's base-to-edited patch to the latest content on disk. */
export function applyDocumentEdit(
  baseContent: string,
  editedContent: string,
  currentContent: string,
): AppliedDocumentEdit {
  if (baseContent === editedContent) {
    return { content: currentContent, merged: currentContent !== baseContent };
  }
  if (currentContent === editedContent) {
    return { content: currentContent, merged: currentContent !== baseContent };
  }
  if (currentContent === baseContent) {
    return { content: editedContent, merged: false };
  }

  const patch = createPatch(
    'document.md',
    baseContent,
    editedContent,
    undefined,
    undefined,
    { context: PATCH_CONTEXT_LINES },
  );
  const content = applyPatch(currentContent, patch, {
    fuzzFactor: PATCH_FUZZ_LINES,
  });
  if (content === false) {
    throw new ViewDocumentConflictError(
      'Could not save because this file changed in the same area. Your edits are still in the editor.',
    );
  }
  return { content, merged: true };
}
