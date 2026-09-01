import { describe, expect, it, vi } from 'vitest';
import {
  blockUnsavedChangesUnload,
  confirmDiscardUnsavedChanges,
  UNSAVED_CHANGES_MESSAGE,
} from '../view/src/unsaved-changes.js';

describe('unsaved document changes', () => {
  it('asks before discarding a dirty draft but not a clean document', () => {
    const confirm = vi.fn(() => false);

    expect(confirmDiscardUnsavedChanges(false, confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(confirmDiscardUnsavedChanges(true, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
  });

  it('requests the native unload prompt only for a dirty draft', () => {
    const cleanEvent = {
      preventDefault: vi.fn(),
      returnValue: 'unchanged',
    } as unknown as BeforeUnloadEvent;
    const dirtyEvent = {
      preventDefault: vi.fn(),
      returnValue: 'unchanged',
    } as unknown as BeforeUnloadEvent;

    expect(blockUnsavedChangesUnload(false, cleanEvent)).toBe(false);
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled();
    expect(blockUnsavedChangesUnload(true, dirtyEvent)).toBe(true);
    expect(dirtyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dirtyEvent.returnValue).toBe('');
  });
});
