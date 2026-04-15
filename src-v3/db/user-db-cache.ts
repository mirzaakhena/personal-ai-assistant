// src-v3/db/user-db-cache.ts

import { readdirSync, existsSync } from 'fs';
import { createUserDb, type UserDb } from './user-db.js';

export interface UserDbCache {
  /** Get (or lazily open) the user's DB. Cached for process lifetime. */
  get(userId: string): UserDb;
  /** Enumerate existing user folders under baseDir. */
  listKnownUsers(): string[];
  /** Close all cached DBs (for graceful shutdown). */
  closeAll(): void;
}

export function createUserDbCache(baseDir: string = 'data/users'): UserDbCache {
  const cache = new Map<string, UserDb>();

  return {
    get(userId: string): UserDb {
      let userDb = cache.get(userId);
      if (!userDb) {
        userDb = createUserDb(userId, baseDir);
        cache.set(userId, userDb);
      }
      return userDb;
    },

    listKnownUsers(): string[] {
      if (!existsSync(baseDir)) return [];
      return readdirSync(baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
    },

    closeAll(): void {
      for (const userDb of cache.values()) userDb.close();
      cache.clear();
    },
  };
}
