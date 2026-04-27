// web/dashboard/src/api/skills.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { skillsApi } from './skills.js';

const fetchMock = vi.fn();
const origFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = fetchMock as unknown as typeof fetch; });
afterEach(() => { globalThis.fetch = origFetch; fetchMock.mockReset(); });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

describe('skillsApi', () => {
  it('list passes scope and q in querystring', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ rows: [], total: 0, scope: 'active' }));
    await skillsApi.list('alice', 'active', 'foo');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/users/alice/skills?');
    expect(url).toContain('scope=active');
    expect(url).toContain('q=foo');
  });

  it('detail builds the right URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      name: 'foo', description: 'd', body: '', body_size: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      scope: 'active',
    }));
    const d = await skillsApi.detail('alice', 'active', 'foo');
    expect(d.name).toBe('foo');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/users/alice/skills/active/foo');
  });

  it('count builds the right URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ active: 3, archived: 1 }));
    const c = await skillsApi.count('alice');
    expect(c).toEqual({ active: 3, archived: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/users/alice/skills/_count');
  });

  it('throws ApiError on non-OK response', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'USER_NOT_FOUND', message: 'not found' } }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ));
    await expect(skillsApi.count('ghost')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND', status: 404,
    });
  });
});
