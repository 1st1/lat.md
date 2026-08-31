// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchViewJson,
  updateViewDocument,
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

  // @lat: [[lat.md/view/specs#View Tests#Updates long-running views incrementally#Recovers interrupted document requests]]
  it('recovers interrupted requests without retrying navigation cancellations', async () => {
    const recoveredFetch = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', recoveredFetch);

    await expect(
      fetchViewJson<{ ok: boolean }>('/api/external'),
    ).resolves.toEqual({ ok: true });
    expect(recoveredFetch).toHaveBeenCalledTimes(2);

    const interruptedFetch = vi
      .fn()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', interruptedFetch);

    await expect(fetchViewJson('/api/external')).rejects.toMatchObject({
      name: 'NetworkError',
      message: 'The server connection was interrupted. Try again.',
    });
    expect(interruptedFetch).toHaveBeenCalledTimes(2);

    const cancelledFetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', cancelledFetch);
    const controller = new AbortController();

    const request = fetchViewJson('/api/external', controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelledFetch).toHaveBeenCalledTimes(1);
  });

  // @lat: [[lat.md/view/specs#View Tests#Edits local Markdown safely#Does not replay uncertain writes]]
  it('does not replay an interrupted editor write', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetch);

    await expect(
      updateViewDocument('lat.md', {
        baseContent: '# Before\n',
        content: '# After\n',
      }),
    ).rejects.toMatchObject({
      name: 'NetworkError',
      message: 'The server connection was interrupted. Try again.',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
