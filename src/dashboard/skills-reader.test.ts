// src/dashboard/skills-reader.test.ts

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSkill } from '../skills/storage.js';
import { createSkillsReader, SkillNotFoundError } from './skills-reader.js';

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

  it('skips folders with malformed frontmatter', async () => {
    const dir = join(baseDir, 'users', 'alice', '.claude', 'skills', 'broken-one');
    await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(dir, 'SKILL.md'), 'no frontmatter here', 'utf8'));
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'good-one',
      description: 'ok', body: 'ok body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');
    expect(rows.map((r) => r.name)).toEqual(['good-one']);
  });

  it('skips folders that do not match the skill name regex', async () => {
    const fs = await import('node:fs/promises');
    const dir = join(baseDir, 'users', 'alice', '.claude', 'skills', 'BAD_NAME');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'SKILL.md'), 'whatever', 'utf8');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'good-one',
      description: 'ok', body: 'ok body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');
    expect(rows.map((r) => r.name)).toEqual(['good-one']);
  });

  it('reads the archived directory when scope is archived', async () => {
    const fs = await import('node:fs/promises');
    const dir = join(baseDir, 'users', 'alice', '.archived-skills', 'old-skill');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'SKILL.md'),
      `---\nname: old-skill\ndescription: archived one\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-02T00:00:00.000Z\n---\n\nbody\n`,
      'utf8');

    const reader = createSkillsReader({ baseDir });
    const active = await reader.list('alice', 'active');
    const archived = await reader.list('alice', 'archived');
    expect(active).toEqual([]);
    expect(archived.map((r) => r.name)).toEqual(['old-skill']);
    expect(archived[0].scope).toBe('archived');
  });

  it('sorts by updated_at desc, name asc as tiebreaker', async () => {
    const fs = await import('node:fs/promises');
    const mk = async (name: string, updated: string) => {
      const d = join(baseDir, 'users', 'alice', '.claude', 'skills', name);
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(join(d, 'SKILL.md'),
        `---\nname: ${name}\ndescription: x\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: ${updated}\n---\n\n`,
        'utf8');
    };
    await mk('a-skill', '2026-04-01T00:00:00.000Z');
    await mk('b-skill', '2026-04-10T00:00:00.000Z');
    await mk('c-skill', '2026-04-10T00:00:00.000Z');

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.list('alice', 'active');
    expect(rows.map((r) => r.name)).toEqual(['b-skill', 'c-skill', 'a-skill']);
  });
});

describe('SkillsReader.search', () => {
  it('matches name substring case-insensitively', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'expense-tracker',
      description: 'log expenses', body: 'irrelevant' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'mood-log',
      description: 'log moods', body: 'irrelevant' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', 'EXPENSE');
    expect(rows.map((r) => r.name)).toEqual(['expense-tracker']);
  });

  it('matches description substring case-insensitively', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'a-one',
      description: 'tracks moods over time', body: 'body' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'b-one',
      description: 'unrelated', body: 'body' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', 'moods');
    expect(rows.map((r) => r.name)).toEqual(['a-one']);
  });

  it('matches body substring when name+description do not match', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'short', body: 'mentions kebab-case in detail' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'two',
      description: 'short', body: 'unrelated' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', 'kebab-case');
    expect(rows.map((r) => r.name)).toEqual(['one']);
  });

  it('returns all entries when q is empty string', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'one',
      description: 'x', body: '' });
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'two',
      description: 'y', body: '' });

    const reader = createSkillsReader({ baseDir });
    const rows = await reader.search('alice', 'active', '');
    expect(rows).toHaveLength(2);
  });
});

describe('SkillsReader.detail', () => {
  it('returns the full body for a known skill', async () => {
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'foo-skill',
      description: 'foo desc', body: '# Heading\n\nbody here\n' });

    const reader = createSkillsReader({ baseDir });
    const d = await reader.detail('alice', 'active', 'foo-skill');
    expect(d.name).toBe('foo-skill');
    expect(d.description).toBe('foo desc');
    expect(d.body).toBe('# Heading\n\nbody here\n');
    expect(d.body_size).toBe(Buffer.byteLength(d.body, 'utf8'));
    expect(d.scope).toBe('active');
  });

  it('throws SkillNotFoundError when file is missing', async () => {
    const reader = createSkillsReader({ baseDir });
    await expect(reader.detail('alice', 'active', 'nope'))
      .rejects.toBeInstanceOf(SkillNotFoundError);
  });

  it('throws SkillNotFoundError when name is invalid', async () => {
    const reader = createSkillsReader({ baseDir });
    await expect(reader.detail('alice', 'active', 'BAD_NAME'))
      .rejects.toBeInstanceOf(SkillNotFoundError);
  });
});

describe('SkillsReader cache', () => {
  it('serves listings from cache within TTL', async () => {
    const fs = await import('node:fs/promises');
    await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'first',
      description: 'one', body: '' });

    const reader = createSkillsReader({ baseDir });
    const before = await reader.list('alice', 'active');
    expect(before).toHaveLength(1);

    // Add a second skill straight to disk (bypassing cache invalidation).
    const d = join(baseDir, 'users', 'alice', '.claude', 'skills', 'second');
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(join(d, 'SKILL.md'),
      `---\nname: second\ndescription: two\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
      'utf8');

    const after = await reader.list('alice', 'active');
    expect(after).toHaveLength(1); // cache returns stale list
  });

  it('refreshes after TTL', async () => {
    vi.useFakeTimers();
    try {
      const fs = await import('node:fs/promises');
      await writeSkill({ dataDir: baseDir, userId: 'alice', name: 'first',
        description: 'one', body: '' });

      const reader = createSkillsReader({ baseDir });
      await reader.list('alice', 'active');

      const d = join(baseDir, 'users', 'alice', '.claude', 'skills', 'second');
      await fs.mkdir(d, { recursive: true });
      await fs.writeFile(join(d, 'SKILL.md'),
        `---\nname: second\ndescription: two\ncreated_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n---\n\n`,
        'utf8');

      vi.advanceTimersByTime(11_000);
      const after = await reader.list('alice', 'active');
      expect(after).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
