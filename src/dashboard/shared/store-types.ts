export const STORE_NAMES = [
  'profile', 'preferences', 'knowledge', 'journal',
  'tasks', 'cronjobs', 'messages', 'reactions',
  'sessions', 'ledger', 'query_costs',
] as const;

export type StoreName = typeof STORE_NAMES[number];

export type StoreCategory = 'memory' | 'activity' | 'system';

export const STORE_CATEGORY: Record<StoreName, StoreCategory> = {
  profile: 'memory', preferences: 'memory', knowledge: 'memory', journal: 'memory',
  tasks: 'activity', cronjobs: 'activity', messages: 'activity', reactions: 'activity',
  sessions: 'system', ledger: 'system', query_costs: 'system',
};
