import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', async () => {
  const mod = await vi.importActual<{ default: any }>('better-sqlite3');
  const Actual = mod.default;
  function MockDatabase(_path: string) {
    return new Actual(':memory:');
  }
  return { default: MockDatabase };
});

beforeEach(() => {
  vi.resetModules();
});

describe('getSessionId', () => {
  it('returns undefined for an unknown phone number', async () => {
    const { getSessionId } = await import('../../db/sessions.js');
    expect(getSessionId('628111')).toBeUndefined();
  });
});

describe('saveSessionId / getSessionId', () => {
  it('saves and retrieves a session id', async () => {
    const { saveSessionId, getSessionId } = await import('../../db/sessions.js');
    saveSessionId('628111', 'sess-abc');
    expect(getSessionId('628111')).toBe('sess-abc');
  });

  it('overwrites session id on upsert for the same phone number', async () => {
    const { saveSessionId, getSessionId } = await import('../../db/sessions.js');
    saveSessionId('628111', 'sess-old');
    saveSessionId('628111', 'sess-new');
    expect(getSessionId('628111')).toBe('sess-new');
  });

  it('isolates sessions between different phone numbers', async () => {
    const { saveSessionId, getSessionId } = await import('../../db/sessions.js');
    saveSessionId('628111', 'sess-a');
    saveSessionId('628222', 'sess-b');
    expect(getSessionId('628111')).toBe('sess-a');
    expect(getSessionId('628222')).toBe('sess-b');
  });
});

describe('deleteSessionId', () => {
  it('removes a saved session', async () => {
    const { saveSessionId, getSessionId, deleteSessionId } = await import('../../db/sessions.js');
    saveSessionId('628111', 'sess-abc');
    deleteSessionId('628111');
    expect(getSessionId('628111')).toBeUndefined();
  });

  it('does not throw when deleting a non-existent phone number', async () => {
    const { deleteSessionId } = await import('../../db/sessions.js');
    expect(() => deleteSessionId('628999')).not.toThrow();
  });

  it('does not affect other phone numbers', async () => {
    const { saveSessionId, getSessionId, deleteSessionId } = await import('../../db/sessions.js');
    saveSessionId('628111', 'sess-a');
    saveSessionId('628222', 'sess-b');
    deleteSessionId('628111');
    expect(getSessionId('628111')).toBeUndefined();
    expect(getSessionId('628222')).toBe('sess-b');
  });
});
