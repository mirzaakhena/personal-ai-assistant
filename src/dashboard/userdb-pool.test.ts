// src/dashboard/userdb-pool.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createUserDb } from '../db/user-db.js';
import { createUserDbPool, DbBusyError } from './userdb-pool.js';

let baseDir: string;
beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'pool-'));
});
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeUserOnDisk(uid: string): void {
  const db = createUserDb(uid, baseDir);
  db.profile.setMany([{ key: 'name', value: 'X' }]);
  db.close();
}

describe('createUserDbPool', () => {
  it('lists user IDs by scanning baseDir', () => {
    makeUserOnDisk('alice');
    makeUserOnDisk('bob');
    const pool = createUserDbPool({ baseDir });
    expect(pool.listUserIds().sort()).toEqual(['alice', 'bob']);
  });

  it('returns the active user instance instead of opening a second handle', () => {
    makeUserOnDisk('alice');
    const active = createUserDb('alice', baseDir);
    const pool = createUserDbPool({ baseDir, activeUser: { userId: 'alice', db: active } });
    expect(pool.acquire('alice')).toBe(active);
    active.close();
  });

  it('opens non-active user read-only and caches', () => {
    makeUserOnDisk('alice');
    const pool = createUserDbPool({ baseDir });
    const a = pool.acquire('alice');
    const b = pool.acquire('alice');
    expect(a).toBe(b);
    pool.dispose();
  });

  it('throws USER_NOT_FOUND for missing user dir', () => {
    const pool = createUserDbPool({ baseDir });
    expect(() => pool.acquire('ghost')).toThrowError(/USER_NOT_FOUND/);
  });

  it('retries SQLITE_BUSY then throws DbBusyError', async () => {
    makeUserOnDisk('alice');
    const pool = createUserDbPool({ baseDir });
    let attempts = 0;
    await expect(pool.runWithRetry(async () => {
      attempts += 1;
      const err = new Error('database is locked') as Error & { code?: string };
      err.code = 'SQLITE_BUSY';
      throw err;
    })).rejects.toThrow(DbBusyError);
    expect(attempts).toBe(3);
    pool.dispose();
  });

  it('runWithRetry passes through non-busy errors immediately', async () => {
    const pool = createUserDbPool({ baseDir });
    let attempts = 0;
    await expect(pool.runWithRetry(async () => {
      attempts += 1;
      throw new Error('something else');
    })).rejects.toThrow('something else');
    expect(attempts).toBe(1);
  });
});
