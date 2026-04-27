// web/dashboard/src/api/skills.ts

import { apiGet } from './client.js';
import type {
  SkillScope,
  SkillsListResponse,
  SkillsCountResponse,
  SkillDetail,
} from '@shared/skills-types.js';

export const skillsApi = {
  list: (uid: string, scope: SkillScope, q?: string) => {
    const qs = new URLSearchParams({ scope });
    if (q) qs.set('q', q);
    return apiGet<SkillsListResponse>(`/api/users/${uid}/skills?${qs}`);
  },
  detail: (uid: string, scope: SkillScope, name: string) =>
    apiGet<SkillDetail>(`/api/users/${uid}/skills/${scope}/${name}`),
  count: (uid: string) =>
    apiGet<SkillsCountResponse>(`/api/users/${uid}/skills/_count`),
};
