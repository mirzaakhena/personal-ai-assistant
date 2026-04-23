// src/tools/message-history.test.ts

import { describe, it, expect } from 'vitest';
import {
  handleSearchMessages,
  type MessageHandlers,
  type MessageSearchResult,
} from './message-history.js';

function rec(id: string, ts: number, body: string): MessageSearchResult {
  return {
    id,
    timestamp: ts,
    sender: 'user',
    body,
    has_media: false,
    gateway: 'console',
  };
}

describe('handleSearchMessages', () => {
  it('routes to getByIds when ids provided', async () => {
    let searchCalled = false;
    const idsCalled: string[][] = [];

    const handlers: MessageHandlers = {
      search: () => {
        searchCalled = true;
        return [];
      },
      getByIds: (ids) => {
        idsCalled.push(ids);
        return ids.map((id) => rec(id, 1_700_000_000, `body ${id}`));
      },
      count: () => 0,
    };

    const out = await handleSearchMessages(handlers, { ids: ['a', 'b'] });

    expect(searchCalled).toBe(false);
    expect(idsCalled).toEqual([['a', 'b']]);
    expect(out.count).toBe(2);
    expect(out.results.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('routes to search when ids omitted', async () => {
    let searchArgsSeen: unknown = null;
    const handlers: MessageHandlers = {
      search: (filter) => {
        searchArgsSeen = filter;
        return [rec('m1', 1_700_000_000, 'hello')];
      },
      getByIds: () => [],
      count: () => 0,
    };

    const out = await handleSearchMessages(handlers, { limit: 10, query: 'hello' });
    expect(searchArgsSeen).toEqual({
      fromTime: undefined,
      toTime: undefined,
      sender: undefined,
      query: 'hello',
      gateway: undefined,
      hasMedia: undefined,
      limit: 10,
      order: undefined,
    });
    expect(out.count).toBe(1);
  });

  it('empty ids array falls back to search path', async () => {
    let searchCalled = false;
    const handlers: MessageHandlers = {
      search: () => {
        searchCalled = true;
        return [];
      },
      getByIds: () => [],
      count: () => 0,
    };
    await handleSearchMessages(handlers, { ids: [] });
    expect(searchCalled).toBe(true);
  });

  it('formats timestamps to ISO-Jakarta in results', async () => {
    const handlers: MessageHandlers = {
      search: () => [rec('m1', 1_700_000_000_000, 'x')],
      getByIds: () => [],
      count: () => 0,
    };
    const out = await handleSearchMessages(handlers, {});
    expect(out.results[0].timestamp).toMatch(/\+07:00$/);
  });
});
