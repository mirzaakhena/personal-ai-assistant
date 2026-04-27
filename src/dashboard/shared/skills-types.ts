// src/dashboard/shared/skills-types.ts

export type SkillScope = 'active' | 'archived';

export type SkillSummary = {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  body_size: number;
  scope: SkillScope;
};

export type SkillDetail = SkillSummary & { body: string };

export type SkillsListResponse = {
  rows: SkillSummary[];
  total: number;
  scope: SkillScope;
};

export type SkillsCountResponse = { active: number; archived: number };
