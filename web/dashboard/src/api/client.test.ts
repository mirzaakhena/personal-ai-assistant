import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGet, apiPost, ApiError } from './client.js';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('apiGet', () => {
  it('returns JSON on 200', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ a: 1 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    expect(await apiGet('/api/x')).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/x', expect.objectContaining({
      credentials: 'include',
    }));
  });

  it('throws ApiError shaped from server JSON on 4xx/5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: 'INVALID_QUERY', message: 'bad' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    await expect(apiGet('/api/x')).rejects.toMatchObject({
      code: 'INVALID_QUERY', status: 400, message: 'bad',
    });
  });

  it('throws ApiError for non-JSON 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(apiGet('/api/x')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('apiPost', () => {
  it('sends JSON body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await apiPost('/api/auth', { token: 'x' });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
      body: JSON.stringify({ token: 'x' }),
    }));
  });
});
