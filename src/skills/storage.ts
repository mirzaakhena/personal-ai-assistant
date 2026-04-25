// src/skills/storage.ts

import { promises as fs, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type {
  WriteResult,
  ArchiveResult,
  SkillFrontmatter,
} from './types.js';
import { CLAUDE_MD_TEMPLATE, WRITING_SKILLS_TEMPLATE } from './templates.js';

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_NAME = 3;
const MAX_NAME = 60;

function validateName(name: string): void {
  if (
    name.length < MIN_NAME ||
    name.length > MAX_NAME ||
    !SKILL_NAME_RE.test(name)
  ) {
    throw new Error(`invalid skill name: ${JSON.stringify(name)}`);
  }
}

function skillDir(dataDir: string, userId: string, name: string): string {
  return join(dataDir, 'users', userId, '.claude', 'skills', name);
}

function archivedDir(dataDir: string, userId: string, name: string): string {
  return join(dataDir, 'users', userId, '.archived-skills', name);
}

function renderFrontmatter(fm: SkillFrontmatter, body: string): string {
  return (
    `---\n` +
    `name: ${fm.name}\n` +
    `description: ${fm.description}\n` +
    `created_at: ${fm.created_at}\n` +
    `updated_at: ${fm.updated_at}\n` +
    `---\n\n` +
    body +
    (body.endsWith('\n') ? '' : '\n')
  );
}

async function readExistingCreatedAt(
  skillPath: string
): Promise<string | null> {
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const m = /^created_at:\s*(.+)$/m.exec(content);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export async function ensureUserSkillDir(opts: {
  dataDir: string;
  userId: string;
}): Promise<void> {
  const dir = join(opts.dataDir, 'users', opts.userId, '.claude', 'skills');
  await fs.mkdir(dir, { recursive: true });
}

export async function writeSkill(opts: {
  dataDir: string;
  userId: string;
  name: string;
  description: string;
  body: string;
}): Promise<WriteResult> {
  validateName(opts.name);

  const dir = skillDir(opts.dataDir, opts.userId, opts.name);
  const filePath = join(dir, 'SKILL.md');
  const tmpPath = join(dir, 'SKILL.md.tmp');

  await fs.mkdir(dir, { recursive: true });

  const existingCreatedAt = await readExistingCreatedAt(filePath);
  const now = new Date().toISOString();

  const fm: SkillFrontmatter = {
    name: opts.name,
    description: opts.description,
    created_at: existingCreatedAt ?? now,
    updated_at: now,
  };

  const rendered = renderFrontmatter(fm, opts.body);
  await fs.writeFile(tmpPath, rendered, 'utf8');
  await fs.rename(tmpPath, filePath);

  return {
    status: existingCreatedAt ? 'updated' : 'created',
    path: filePath,
  };
}

export async function archiveSkill(opts: {
  dataDir: string;
  userId: string;
  name: string;
}): Promise<ArchiveResult> {
  validateName(opts.name);
  const from = skillDir(opts.dataDir, opts.userId, opts.name);
  if (!existsSync(from)) return { status: 'not_found', name: opts.name };

  const to = archivedDir(opts.dataDir, opts.userId, opts.name);
  await fs.mkdir(dirname(to), { recursive: true });

  // Collision guard: if an archive with the same name already exists, suffix
  // with millis so the original archive is preserved.
  let finalTo = to;
  if (existsSync(to)) {
    finalTo = `${to}-${Date.now()}`;
  }
  await fs.rename(from, finalTo);
  return { status: 'archived', from, to: finalTo };
}

/**
 * Provision per-user CLAUDE.md if it does not exist. Idempotent: never
 * overwrites a user-customized CLAUDE.md. Path:
 *   <dataDir>/users/<userId>/CLAUDE.md
 *
 * The Claude Agent SDK auto-loads this file when `settingSources` includes
 * 'project' and the SDK query's cwd matches this directory (see
 * src/ai-engine/options.ts).
 */
export async function ensureUserClaudeMd(opts: {
  dataDir: string;
  userId: string;
}): Promise<void> {
  const userDir = join(opts.dataDir, 'users', opts.userId);
  const filePath = join(userDir, 'CLAUDE.md');
  if (existsSync(filePath)) return;
  await fs.mkdir(userDir, { recursive: true });
  await fs.writeFile(filePath, CLAUDE_MD_TEMPLATE, 'utf8');
}

// Temporary stub — real implementation in Task 3.
export async function ensureMetaSkill(_opts: {
  dataDir: string;
  userId: string;
}): Promise<void> {
  void WRITING_SKILLS_TEMPLATE;
  return;
}
