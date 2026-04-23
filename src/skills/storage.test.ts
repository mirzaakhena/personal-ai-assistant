// src/skills/storage.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeSkill,
  archiveSkill,
  ensureUserSkillDir,
  SKILL_NAME_RE,
} from './storage.js';

describe('SKILL_NAME_RE', () => {
  it('accepts kebab-case names', () => {
    expect(SKILL_NAME_RE.test('evening-wind-down')).toBe(true);
    expect(SKILL_NAME_RE.test('abc')).toBe(true);
    expect(SKILL_NAME_RE.test('a1-b2-c3')).toBe(true);
  });

  it('rejects path traversal and bad chars', () => {
    expect(SKILL_NAME_RE.test('../escape')).toBe(false);
    expect(SKILL_NAME_RE.test('with space')).toBe(false);
    expect(SKILL_NAME_RE.test('UPPER')).toBe(false);
    expect(SKILL_NAME_RE.test('has_underscore')).toBe(false);
    expect(SKILL_NAME_RE.test('-starts-with-dash')).toBe(false);
  });
});

describe('writeSkill / archiveSkill / ensureUserSkillDir', () => {
  let dataDir: string;
  const userId = 'u1';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'v4-skill-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a new skill file with frontmatter', async () => {
    const res = await writeSkill({
      dataDir,
      userId,
      name: 'evening-wind-down',
      description: 'Use when user reports feeling tired',
      body: '# Evening wind-down\n\nSteps here...',
    });
    expect(res.status).toBe('created');

    const p = join(
      dataDir,
      'users',
      userId,
      '.claude',
      'skills',
      'evening-wind-down',
      'SKILL.md'
    );
    expect(existsSync(p)).toBe(true);

    const content = readFileSync(p, 'utf8');
    expect(content).toContain('name: evening-wind-down');
    expect(content).toContain('description: Use when user reports feeling tired');
    expect(content).toContain('# Evening wind-down');
    expect(content).toMatch(/created_at: /);
    expect(content).toMatch(/updated_at: /);
  });

  it('updates existing skill while preserving created_at', async () => {
    await writeSkill({
      dataDir,
      userId,
      name: 'skx',
      description: 'First version',
      body: 'First body',
    });
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await writeSkill({
      dataDir,
      userId,
      name: 'skx',
      description: 'Updated version',
      body: 'Updated body',
    });
    expect(r2.status).toBe('updated');

    const p = join(dataDir, 'users', userId, '.claude', 'skills', 'skx', 'SKILL.md');
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('description: Updated version');
    expect(content).toContain('Updated body');

    const created = /created_at: (.+)/.exec(content)?.[1];
    const updated = /updated_at: (.+)/.exec(content)?.[1];
    expect(created).toBeDefined();
    expect(updated).toBeDefined();
    expect(created).not.toBe(updated);
  });

  it('rejects invalid skill names', async () => {
    await expect(
      writeSkill({
        dataDir,
        userId,
        name: '../escape',
        description: 'x',
        body: 'y',
      })
    ).rejects.toThrow(/invalid skill name/i);
  });

  it('archives a skill by moving its directory', async () => {
    await writeSkill({
      dataDir,
      userId,
      name: 'my-skill',
      description: 'x',
      body: 'y',
    });
    const res = await archiveSkill({ dataDir, userId, name: 'my-skill' });
    expect(res.status).toBe('archived');

    const activePath = join(
      dataDir,
      'users',
      userId,
      '.claude',
      'skills',
      'my-skill'
    );
    const archivedPath = join(
      dataDir,
      'users',
      userId,
      '.archived-skills',
      'my-skill'
    );
    expect(existsSync(activePath)).toBe(false);
    expect(existsSync(archivedPath)).toBe(true);
  });

  it('archiveSkill returns not_found when skill does not exist', async () => {
    const res = await archiveSkill({ dataDir, userId, name: 'ghost' });
    expect(res.status).toBe('not_found');
  });

  it('ensureUserSkillDir creates .claude/skills/ if missing', async () => {
    await ensureUserSkillDir({ dataDir, userId });
    const p = join(dataDir, 'users', userId, '.claude', 'skills');
    expect(existsSync(p)).toBe(true);
  });

  it('ensureUserSkillDir is idempotent (no error when dir exists)', async () => {
    await ensureUserSkillDir({ dataDir, userId });
    await ensureUserSkillDir({ dataDir, userId });
    const p = join(dataDir, 'users', userId, '.claude', 'skills');
    expect(existsSync(p)).toBe(true);
  });
});
