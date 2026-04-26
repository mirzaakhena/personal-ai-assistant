// src/dashboard/filter-builder.test.ts

import { describe, it, expect } from 'vitest';
import { buildListQuery, BadQueryError } from './filter-builder.js';
import { STORE_CONFIG } from './store-config.js';

describe('buildListQuery — knowledge', () => {
  const cfg = STORE_CONFIG.knowledge;

  it('builds default sort + pagination when no params', () => {
    const built = buildListQuery(cfg, {});
    expect(built.where).toBe('');
    expect(built.params).toEqual([]);
    expect(built.orderBy).toBe('ORDER BY updated_at DESC');
    expect(built.limit).toBe(50);
    expect(built.offset).toBe(0);
  });

  it('parameterizes enum filter', () => {
    const built = buildListQuery(cfg, { filter: { category: 'person' } });
    expect(built.where).toBe('WHERE category = ?');
    expect(built.params).toEqual(['person']);
  });

  it('rejects unknown filter key', () => {
    expect(() => buildListQuery(cfg, { filter: { foo: 'bar' } }))
      .toThrow(BadQueryError);
  });

  it('rejects enum value outside allow-list', () => {
    expect(() => buildListQuery(cfg, { filter: { category: '../etc/passwd' } }))
      .toThrow(BadQueryError);
  });

  it('rejects unknown sort key', () => {
    expect(() => buildListQuery(cfg, { sort: 'foo:asc' }))
      .toThrow(BadQueryError);
  });

  it('honors sort direction', () => {
    const built = buildListQuery(cfg, { sort: 'key:asc' });
    expect(built.orderBy).toBe('ORDER BY key ASC');
  });

  it('clamps limit to 200', () => {
    const built = buildListQuery(cfg, { limit: 9999 });
    expect(built.limit).toBe(200);
  });

  it('rejects page < 1', () => {
    expect(() => buildListQuery(cfg, { page: 0 })).toThrow(BadQueryError);
  });
});

describe('buildListQuery — ledger date range', () => {
  const cfg = STORE_CONFIG.ledger;

  it('builds BETWEEN clause from date-range filter (epoch ms)', () => {
    const built = buildListQuery(cfg, {
      filter: { ts: ['1700000000000', '1800000000000'] },
    });
    expect(built.where).toBe('WHERE ts >= ? AND ts <= ?');
    expect(built.params).toEqual([1700000000000, 1800000000000]);
  });
});

describe('buildListQuery — ledger substring filter', () => {
  const cfg = STORE_CONFIG.ledger;

  it('builds LIKE clause from substring filter', () => {
    const built = buildListQuery(cfg, { filter: { tags: 'spending' } });
    expect(built.where).toBe('WHERE tags LIKE ?');
    expect(built.params).toEqual(['%spending%']);
  });
});

describe('buildListQuery — defensive guards', () => {
  const cfg = STORE_CONFIG.knowledge;

  it('rejects sort with no colon', () => {
    expect(() => buildListQuery(cfg, { sort: 'updated_at' })).toThrow(BadQueryError);
  });

  it('rejects negative limit', () => {
    expect(() => buildListQuery(cfg, { limit: -5 })).toThrow(BadQueryError);
  });

  it('rejects fractional limit', () => {
    expect(() => buildListQuery(cfg, { limit: 1.7 })).toThrow(BadQueryError);
  });

  it('rejects NaN limit', () => {
    expect(() => buildListQuery(cfg, { limit: NaN })).toThrow(BadQueryError);
  });

  it('rejects fractional page', () => {
    expect(() => buildListQuery(cfg, { page: 1.5 })).toThrow(BadQueryError);
  });
});
