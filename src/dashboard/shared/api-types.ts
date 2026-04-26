import type { StoreName, StoreCategory } from './store-types.js';
import type { StoreConfig, ChartDef } from './store-meta.js';

export type ApiError = {
  error: { code: ErrorCode; message: string; details?: unknown };
};

export type ErrorCode =
  | 'INVALID_QUERY'
  | 'UNAUTHENTICATED'
  | 'USER_NOT_FOUND'
  | 'STORE_NOT_FOUND'
  | 'DB_BUSY'
  | 'INTERNAL';

export type AuthLoginRequest = { token: string };
export type AuthLoginResponse = { ok: true };

export type UsersListResponse = { users: Array<{ userId: string }> };

export type StoreSummary = {
  name: StoreName;
  category: StoreCategory;
  count: number;
};
export type StoresResponse = { stores: StoreSummary[] };

export type ListQuery = {
  filter?: Record<string, string | string[]>;
  sort?: string;       // "key:asc" or "key:desc"
  page?: number;       // 1-indexed
  limit?: number;      // default 50, max 200
};
export type ListResponse<Row = Record<string, unknown>> = {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
};

export type SearchQuery = ListQuery & { q: string };
export type SearchHit<Row = Record<string, unknown>> = Row & { snippet?: string };
export type SearchResponse<Row = Record<string, unknown>> = {
  hits: SearchHit<Row>[];
  total: number;
  page: number;
  limit: number;
};

export type ChartPayload =
  | { type: 'line'; xKey: string; yKey: string; series: Array<Record<string, number | string>> }
  | { type: 'bar'; xKey: string; yKey: string; series: Array<Record<string, number | string>> }
  | { type: 'donut'; series: Array<{ name: string; value: number }> };

export type StatsResponse = { charts: Record<string, ChartPayload> };

export type MetaResponse = { stores: Record<StoreName, StoreConfig> };
