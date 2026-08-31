export const UNSAVED_CHANGES_MESSAGE =
  'You have unsaved changes. Discard them?';

export function confirmDiscardUnsavedChanges(
  dirty: boolean,
  confirm: (message: string) => boolean,
): boolean {
  return !dirty || confirm(UNSAVED_CHANGES_MESSAGE);
}

export function blockUnsavedChangesUnload(
  dirty: boolean,
  event: BeforeUnloadEvent,
): boolean {
  if (!dirty) return false;
  event.preventDefault();
  event.returnValue = '';
  return true;
}
