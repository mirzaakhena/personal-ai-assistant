import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeStore } from './knowledge.js';

describe('knowledge store', () => {
  let tmp: string; let db: Database.Database;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v5-knl-'));
    db = new Database(join(tmp, 'test.db'));
  });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('saves + lists all', () => {
    const s = createKnowledgeStore(db);
    s.saveMany([
      { category: 'identity', key: 'github', value: 'mirzaakhena' },
      { category: 'person', key: 'istri_tika', value: 'Tika, istri Mirza' },
    ]);
    expect(s.list()).toHaveLength(2);
  });

  it('filters list by category', () => {
    const s = createKnowledgeStore(db);
    s.saveMany([
      { category: 'identity', key: 'a', value: '1' },
      { category: 'identity', key: 'b', value: '2' },
      { category: 'person', key: 'c', value: '3' },
    ]);
    expect(s.list({ category: 'identity' })).toHaveLength(2);
    expect(s.list({ category: 'person' })).toHaveLength(1);
  });

  it('upserts on (category, key)', () => {
    const s = createKnowledgeStore(db);
    s.saveMany([{ category: 'identity', key: 'x', value: 'v1' }]);
    s.saveMany([{ category: 'identity', key: 'x', value: 'v2' }]);
    expect(s.list()).toHaveLength(1);
    expect(s.list()[0].value).toBe('v2');
  });

  it('FTS search finds rows by value', () => {
    const s = createKnowledgeStore(db);
    s.saveMany([
      { category: 'context', key: 'halal_food_busan', value: 'Ayla Kebab restoran halal Uzbek area Pukyong' },
      { category: 'context', key: 'emart', value: 'Supermarket EMart Busan' },
    ]);
    const results = s.search('halal');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('halal_food_busan');
  });

  it('FTS search respects category filter', () => {
    const s = createKnowledgeStore(db);
    s.saveMany([
      { category: 'context', key: 'a', value: 'shared term' },
      { category: 'identity', key: 'b', value: 'shared term' },
    ]);
    expect(s.search('shared')).toHaveLength(2);
    expect(s.search('shared', { category: 'context' })).toHaveLength(1);
  });

  it('deletes + returns boolean', () => {
    const s = createKnowledgeStore(db);
    s.saveMany([{ category: 'identity', key: 'x', value: 'y' }]);
    expect(s.delete({ category: 'identity', key: 'x' })).toBe(true);
    expect(s.delete({ category: 'identity', key: 'x' })).toBe(false);
  });

  it('rejects invalid category', () => {
    const s = createKnowledgeStore(db);
    expect(() => s.saveMany([{ category: 'bogus' as any, key: 'x', value: 'y' }]))
      .toThrow(/invalid KnowledgeCategory/);
  });
});
