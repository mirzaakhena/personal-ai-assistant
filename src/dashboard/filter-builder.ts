// src/dashboard/filter-builder.ts

import type { StoreConfig, FilterDef } from './shared/store-meta.js';
import type { ListQuery } from './shared/api-types.js';

export class BadQueryError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'BadQueryError';
  }
}

export type BuiltQuery = {
  where: string;       // '' or 'WHERE ...'
  params: Array<string | number>;
  orderBy: string;     // 'ORDER BY ...'
  limit: number;
  offset: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function buildListQuery(cfg: StoreConfig, q: ListQuery): BuiltQuery {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (q.filter) {
    for (const [key, raw] of Object.entries(q.filter)) {
      const def = cfg.filters.find((f) => f.key === key);
      if (!def) throw new BadQueryError(`unknown filter key: ${key}`, { key });
      applyFilter(def, raw, clauses, params);
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  let sortKey = cfg.defaultSort.key;
  let sortDir: 'asc' | 'desc' = cfg.defaultSort.dir;
  if (q.sort) {
    const parts = q.sort.split(':');
    if (parts.length !== 2) {
      throw new BadQueryError(`sort must be 'key:asc|desc', got ${q.sort}`);
    }
    const [k, d] = parts;
    if (!cfg.sortable.includes(k)) throw new BadQueryError(`unknown sort key: ${k}`);
    if (d !== 'asc' && d !== 'desc') throw new BadQueryError(`bad sort direction: ${d}`);
    sortKey = k;
    sortDir = d;
  }
  const orderBy = `ORDER BY ${sortKey} ${sortDir.toUpperCase()}`;

  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1)) {
    throw new BadQueryError(`limit must be a positive integer, got ${q.limit}`);
  }
  if (q.page !== undefined && !Number.isInteger(q.page)) {
    throw new BadQueryError(`page must be an integer, got ${q.page}`);
  }
  const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const page = q.page ?? 1;
  if (page < 1) throw new BadQueryError(`page must be >= 1, got ${page}`);
  const offset = (page - 1) * limit;

  return { where, params, orderBy, limit, offset };
}

function applyFilter(
  def: FilterDef,
  raw: string | string[],
  clauses: string[],
  params: Array<string | number>,
): void {
  switch (def.type) {
    case 'string': {
      if (Array.isArray(raw)) throw new BadQueryError(`${def.key} expects scalar`);
      clauses.push(`${def.key} = ?`);
      params.push(raw);
      return;
    }
    case 'substring': {
      if (Array.isArray(raw)) throw new BadQueryError(`${def.key} expects scalar`);
      clauses.push(`${def.key} LIKE ?`);
      params.push(`%${raw}%`);
      return;
    }
    case 'enum': {
      if (Array.isArray(raw)) throw new BadQueryError(`${def.key} expects scalar`);
      if (!def.options.includes(raw)) {
        throw new BadQueryError(`${def.key}=${raw} not in allowed values`,
          { allowed: def.options });
      }
      clauses.push(`${def.key} = ?`);
      params.push(raw);
      return;
    }
    case 'date-range': {
      const [from, to] = Array.isArray(raw) ? raw : [raw, raw];
      const fromN = Number(from);
      const toN = Number(to);
      if (!Number.isFinite(fromN) || !Number.isFinite(toN)) {
        throw new BadQueryError(`${def.key} date-range needs numeric epoch ms`);
      }
      clauses.push(`${def.key} >= ? AND ${def.key} <= ?`);
      params.push(fromN, toN);
      return;
    }
    case 'number-range': {
      const [from, to] = Array.isArray(raw) ? raw : [raw, raw];
      const fromN = Number(from);
      const toN = Number(to);
      if (!Number.isFinite(fromN) || !Number.isFinite(toN)) {
        throw new BadQueryError(`${def.key} number-range needs numeric values`);
      }
      clauses.push(`${def.key} >= ? AND ${def.key} <= ?`);
      params.push(fromN, toN);
      return;
    }
    default: {
      const _exhaustive: never = def;
      throw new BadQueryError(`unhandled filter type: ${(_exhaustive as FilterDef).type}`);
    }
  }
}
