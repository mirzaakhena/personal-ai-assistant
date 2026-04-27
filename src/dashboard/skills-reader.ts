// src/dashboard/skills-reader.ts

import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SKILL_NAME_RE } from '../skills/storage.js';
import type {
  SkillScope, SkillSummary, SkillDetail,
} from './shared/skills-types.js';
import { log } from '../utils/logger.js';

export type SkillsReader = {
  list(userId: string, scope: SkillScope): Promise<SkillSummary[]>;
  search(userId: string, scope: SkillScope, q: string): Promise<SkillSummary[]>;
  detail(userId: string, scope: SkillScope, name: string): Promise<SkillDetail>;
  count(userId: string): Promise<{ active: number; archived: number }>;
};

export class SkillNotFoundError extends Error {
  constructor(public skillName: string) {
    super(`SKILL_NOT_FOUND: ${skillName}`);
    this.name = 'SkillNotFoundError';
  }
}

function scopeDir(baseDir: string, userId: string, scope: SkillScope): string {
  return scope === 'active'
    ? join(baseDir, 'users', userId, '.claude', 'skills')
    : join(baseDir, 'users', userId, '.archived-skills');
}

type Frontmatter = {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

function parseFrontmatter(text: string): { fm: Frontmatter; body: string } | null {
  // Format produced by src/skills/storage.ts:renderFrontmatter:
  //   ---\nname: ...\ndescription: ...\ncreated_at: ...\nupdated_at: ...\n---\n\n<body>
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const header = text.slice(4, end);
  const body = text.slice(end + 5).replace(/^\n/, '');

  const lines = header.split('\n');
  const map = new Map<string, string>();
  for (const line of lines) {
    const idx = line.indexOf(': ');
    if (idx < 0) return null;
    map.set(line.slice(0, idx), line.slice(idx + 2));
  }
  const name = map.get('name');
  const description = map.get('description');
  const created_at = map.get('created_at');
  const updated_at = map.get('updated_at');
  if (!name || !description || !created_at || !updated_at) return null;
  return { fm: { name, description, created_at, updated_at }, body };
}

const TTL_MS = 10_000;
type CacheEntry = { entries: SkillSummary[]; readAt: number };

export function createSkillsReader(opts: { baseDir: string }): SkillsReader {
  const { baseDir } = opts;
  const cache = new Map<string, CacheEntry>();

  async function readSkill(
    dir: string, name: string, scope: SkillScope,
  ): Promise<{ summary: SkillSummary; body: string } | null> {
    const path = join(dir, name, 'SKILL.md');
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch { return null; }
    const parsed = parseFrontmatter(text);
    if (!parsed) {
      log.debug(`[skills-reader] malformed frontmatter at ${path}`);
      return null;
    }
    return {
      summary: {
        name,
        description: parsed.fm.description,
        created_at: parsed.fm.created_at,
        updated_at: parsed.fm.updated_at,
        body_size: Buffer.byteLength(parsed.body, 'utf8'),
        scope,
      },
      body: parsed.body,
    };
  }

  async function listFresh(userId: string, scope: SkillScope): Promise<SkillSummary[]> {
    const dir = scopeDir(baseDir, userId, scope);
    if (!existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: SkillSummary[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!SKILL_NAME_RE.test(e.name)) continue;
      const got = await readSkill(dir, e.name, scope);
      if (got) out.push(got.summary);
    }
    out.sort((a, b) => {
      if (a.updated_at !== b.updated_at) return b.updated_at.localeCompare(a.updated_at);
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  async function list(userId: string, scope: SkillScope): Promise<SkillSummary[]> {
    const key = `${userId}:${scope}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.readAt < TTL_MS) return cached.entries;
    const entries = await listFresh(userId, scope);
    cache.set(key, { entries, readAt: Date.now() });
    return entries;
  }

  async function search(
    userId: string, scope: SkillScope, q: string,
  ): Promise<SkillSummary[]> {
    const all = await list(userId, scope);
    if (q === '') return all;
    const needle = q.toLowerCase();

    const dir = scopeDir(baseDir, userId, scope);
    const out: SkillSummary[] = [];
    for (const s of all) {
      if (
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle)
      ) {
        out.push(s);
        continue;
      }
      // Pass 2: read body and check
      try {
        const body = await fs.readFile(join(dir, s.name, 'SKILL.md'), 'utf8');
        if (body.toLowerCase().includes(needle)) out.push(s);
      } catch {
        // skill removed between list and search; skip
      }
    }
    return out;
  }
  async function detail(
    userId: string, scope: SkillScope, name: string,
  ): Promise<SkillDetail> {
    if (!SKILL_NAME_RE.test(name)) throw new SkillNotFoundError(name);
    const dir = scopeDir(baseDir, userId, scope);
    const got = await readSkill(dir, name, scope);
    if (!got) throw new SkillNotFoundError(name);
    return { ...got.summary, body: got.body };
  }
  async function countDir(dir: string): Promise<number> {
    if (!existsSync(dir)) return 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let n = 0;
    for (const e of entries) {
      if (e.isDirectory() && SKILL_NAME_RE.test(e.name)) n++;
    }
    return n;
  }

  async function count(userId: string): Promise<{ active: number; archived: number }> {
    const [active, archived] = await Promise.all([
      countDir(scopeDir(baseDir, userId, 'active')),
      countDir(scopeDir(baseDir, userId, 'archived')),
    ]);
    return { active, archived };
  }

  return { list, search, detail, count };
}
