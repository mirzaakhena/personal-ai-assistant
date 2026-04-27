// src/dashboard/routes/skills.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { writeSkill } from '../../skills/storage.js';
import { createUserDb } from '../../db/user-db.js';
import { createUserDbPool } from '../userdb-pool.js';
import { createSkillsReader } from '../skills-reader.js';
import { mountSkillsRoutes } from './skills.js';
import { errorMiddleware } from '../error-middleware.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'skills-route-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

function makeUser(uid: string) {
  const db = createUserDb(uid, baseDir);
  db.close();
}

function makeApp() {
  const pool = createUserDbPool({ baseDir });
  const reader = createSkillsReader({ baseDir });
  const app = express();
  mountSkillsRoutes(app, { pool, reader });
  app.use(errorMiddleware);
  return app;
}

describe('GET /api/users/:uid/skills', () => {
  it('returns 404 when user does not exist', async () => {
    const r = await request(makeApp()).get('/api/users/ghost/skills');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns active skills by default', async () => {
    makeUser('alice');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'first', body: 'body one' });

    const r = await request(makeApp()).get('/api/users/alice/skills');
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('active');
    expect(r.body.total).toBe(1);
    expect(r.body.rows[0].name).toBe('one');
  });

  it('returns archived skills when scope=archived', async () => {
    makeUser('alice');
    const fs = await import('node:fs/promises');
    const dir = join(baseDir, 'users', 'alice', '.archived-skills', 'old');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'SKILL.md'),
      `---\nname: old\ndescription: x\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
      'utf8');

    const r = await request(makeApp()).get('/api/users/alice/skills?scope=archived');
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('archived');
    expect(r.body.rows.map((row: { name: string }) => row.name)).toEqual(['old']);
  });

  it('filters by q (substring across name/description/body)', async () => {
    makeUser('alice');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'first', body: 'mentions xyz' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'two',
      description: 'second', body: 'unrelated' });

    const r = await request(makeApp()).get('/api/users/alice/skills?q=xyz');
    expect(r.status).toBe(200);
    expect(r.body.rows.map((row: { name: string }) => row.name)).toEqual(['one']);
  });

  it('rejects bad scope with 400 INVALID_QUERY', async () => {
    makeUser('alice');
    const r = await request(makeApp()).get('/api/users/alice/skills?scope=junk');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_QUERY');
  });
});
