// src/skills/types.ts

export interface SkillFrontmatter {
  name: string;
  description: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export interface SkillFile {
  frontmatter: SkillFrontmatter;
  body: string;
}

export type WriteResult =
  | { status: 'created'; path: string }
  | { status: 'updated'; path: string };

export type ArchiveResult =
  | { status: 'archived'; from: string; to: string }
  | { status: 'not_found'; name: string };
