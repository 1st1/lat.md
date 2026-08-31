// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchViewJson,
  VIEW_REQUEST_TIMEOUT_MS,
} from '../view/src/data-source.js';

describe('view data source', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // @lat: [[lat.md/view/specs#View Tests#Updates long-running views incrementally#Times out stalled document requests]]
  it('turns a stalled request into a retryable timeout error', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
    );

    const request = fetchViewJson<{ ok: boolean }>('/api/document?path=x.md');
    const rejected = expect(request).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'The server did not respond in time. Try again.',
    });
    await vi.advanceTimersByTimeAsync(VIEW_REQUEST_TIMEOUT_MS);
    await rejected;
  });
});
