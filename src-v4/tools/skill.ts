// src-v4/tools/skill.ts
//
// MCP tools for skill write/archive operations. Discovery of existing skills
// is handled natively by the Claude Agent SDK via the per-user cwd configured
// in ai-engine/options.ts — no list/read tools here.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { writeSkill, archiveSkill, SKILL_NAME_RE } from '../skills/storage.js';

export interface SkillContext {
  dataDir: string;
  userId: string;
}

const WriteInput = {
  name: z
    .string()
    .min(3)
    .max(60)
    .regex(SKILL_NAME_RE, 'kebab-case, 3-60 chars'),
  description: z.string().min(1).max(300),
  body: z.string().min(1),
};

const ArchiveInput = {
  name: z
    .string()
    .min(3)
    .max(60)
    .regex(SKILL_NAME_RE),
};

export async function handleWriteSkill(
  ctx: SkillContext,
  input: { name: string; description: string; body: string }
) {
  return writeSkill({
    dataDir: ctx.dataDir,
    userId: ctx.userId,
    name: input.name,
    description: input.description,
    body: input.body,
  });
}

export async function handleArchiveSkill(
  ctx: SkillContext,
  input: { name: string }
) {
  return archiveSkill({
    dataDir: ctx.dataDir,
    userId: ctx.userId,
    name: input.name,
  });
}

export function createSkillToolServer(ctx: SkillContext) {
  return createSdkMcpServer({
    name: 'skill',
    version: '1.0.0',
    tools: [
      tool(
        'write_skill',
        'Create or update a skill. Upserts by name (preserves created_at, updates updated_at). Body is a markdown document in English.',
        WriteInput,
        async (input) => {
          const result = await handleWriteSkill(ctx, input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
      ),
      tool(
        'archive_skill',
        'Move a skill from active to archived. Archived skills are not discovered by the runtime. Returns not_found if the skill does not exist.',
        ArchiveInput,
        async (input) => {
          const result = await handleArchiveSkill(ctx, input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        }
      ),
    ],
  });
}
