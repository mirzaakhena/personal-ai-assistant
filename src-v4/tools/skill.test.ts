// src-v4/tools/skill.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleWriteSkill, handleArchiveSkill } from './skill.js';

describe('skill MCP handlers', () => {
  let dataDir: string;
  const userId = 'u1';

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'v4-skill-mcp-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('handleWriteSkill creates file and returns created status', async () => {
    const res = await handleWriteSkill(
      { dataDir, userId },
      { name: 'my-skill', description: 'test', body: 'hello' }
    );
    expect(res.status).toBe('created');
    expect(
      existsSync(
        join(dataDir, 'users', userId, '.claude', 'skills', 'my-skill', 'SKILL.md')
      )
    ).toBe(true);
  });

  it('handleWriteSkill updates existing skill', async () => {
    await handleWriteSkill(
      { dataDir, userId },
      { name: 'my-skill', description: 'v1', body: 'b1' }
    );
    const res = await handleWriteSkill(
      { dataDir, userId },
      { name: 'my-skill', description: 'v2', body: 'b2' }
    );
    expect(res.status).toBe('updated');
  });

  it('handleArchiveSkill moves file from active to archived', async () => {
    await handleWriteSkill(
      { dataDir, userId },
      { name: 'kxr', description: 'x', body: 'y' }
    );
    const res = await handleArchiveSkill({ dataDir, userId }, { name: 'kxr' });
    expect(res.status).toBe('archived');
  });

  it('handleArchiveSkill returns not_found when skill absent', async () => {
    const res = await handleArchiveSkill({ dataDir, userId }, { name: 'ghost' });
    expect(res.status).toBe('not_found');
  });
});
