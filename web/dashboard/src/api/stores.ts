// web/dashboard/src/api/stores.ts

import { apiGet, apiPost } from './client.js';
import type {
  AuthLoginResponse, UsersListResponse, StoresResponse,
  ListResponse, SearchResponse, StatsResponse, MetaResponse,
} from '@shared/api-types.js';
import type { StoreName } from '@shared/store-types.js';

export const api = {
  // Auth
  login: (token: string) => apiPost<AuthLoginResponse>('/api/auth', { token }),
  logout: () => apiPost<{ ok: true }>('/api/auth/logout', {}),

  // Meta
  meta: () => apiGet<MetaResponse>('/api/meta'),

  // Users + per-user store summary
  users: () => apiGet<UsersListResponse>('/api/users'),
  storeSummary: (uid: string) => apiGet<StoresResponse>(`/api/users/${uid}/stores`),

  // Generic list
  storeList: (uid: string, store: StoreName, q: URLSearchParams) =>
    apiGet<ListResponse>(`/api/users/${uid}/stores/${store}/list?${q}`),

  // Stats (charts)
  storeStats: (uid: string, store: StoreName, range = '30d') =>
    apiGet<StatsResponse>(`/api/users/${uid}/stores/${store}/stats?range=${range}`),

  // FTS searches
  knowledgeSearch: (uid: string, q: URLSearchParams) =>
    apiGet<SearchResponse>(`/api/users/${uid}/knowledge/search?${q}`),
  messagesSearch: (uid: string, q: URLSearchParams) =>
    apiGet<SearchResponse>(`/api/users/${uid}/messages/search?${q}`),
  messagesThread: (uid: string, sessionId: string, q: URLSearchParams) =>
    apiGet<ListResponse>(`/api/users/${uid}/messages/thread/${sessionId}?${q}`),

  // Ledger aggregate (separate from stats)
  ledgerAggregate: (uid: string, range = '30d') =>
    apiGet<{ groupBy: string; range: string; series: Array<{ stream: string; n: number }> }>(
      `/api/users/${uid}/ledger/aggregate?range=${range}`,
    ),
};
