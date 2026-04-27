// src/dashboard/skills-reader.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSkill } from '../skills/storage.js';
import { createSkillsReader } from './skills-reader.js';

let baseDir: string;
beforeEach(() => { baseDir = mkdtempSync(join(tmpdir(), 'skills-reader-')); });
afterEach(() => rmSync(baseDir, { recursive: true, force: true }));

describe('SkillsReader.list', () => {
  it('returns empty array when user dir does not exist', async () => {
    const reader = createSkillsReader({ baseDir });
    expect(await reader.list('nobody', 'active')).toEqual([]);
  });

  it('lists active skills with parsed frontmatter', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'foo-skill',
      description: 'foo description', body: '# Foo\nbody here' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'bar-skill',
      description: 'bar description', body: 'bar body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');

    expect(rows).toHaveLength(2);
    const foo = rows.find((r) => r.name === 'foo-skill')!;
    expect(foo.description).toBe('foo description');
    expect(foo.scope).toBe('active');
    expect(foo.body_size).toBeGreaterThan(0);
    expect(foo.created_at).toMatch(/^\d{4}-/);
    expect(foo.updated_at).toMatch(/^\d{4}-/);
  });
});
