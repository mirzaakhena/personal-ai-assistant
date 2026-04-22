// src-v4/db/user-db.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserDb, getProfile, getContextHintCounts, type UserDb } from './user-db.js';

describe('getProfile', () => {
  let tmp: string; let db: UserDb;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'v5-ud-')); db = createUserDb('u-test', tmp); });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('empty on fresh user', () => {
    expect(getProfile(db)).toEqual({});
  });

  it('returns flat object of all populated slots', () => {
    db.profile.setMany([
      { key: 'name', value: 'Mirza' },
      { key: 'language', value: 'id' },
      { key: 'timezone', value: 'Asia/Seoul' },
    ]);
    expect(getProfile(db)).toEqual({
      name: 'Mirza', language: 'id', timezone: 'Asia/Seoul',
    });
  });
});

describe('getContextHintCounts', () => {
  let tmp: string; let db: UserDb;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'v5-udc-')); db = createUserDb('u-test', tmp); });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('returns zeros on fresh user', () => {
    const c = getContextHintCounts(db);
    expect(c.tasks).toBe(0);
    expect(c.journal_recent_7d).toBe(0);
    expect(c.knowledge_total).toBe(0);
  });

  it('counts pending tasks + due_today', () => {
    db.tasks.create({ title: 'later' });
    // Build today's YMD in Asia/Jakarta
    const todayWIB = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
    db.tasks.create({ title: 'today', due_date: todayWIB });
    const c = getContextHintCounts(db);
    expect(c.tasks).toBe(2);
    expect(c.tasks_due_today).toBe(1);
  });

  it('breaks down knowledge by category', () => {
    db.knowledge.saveMany([
      { category: 'identity', key: 'a', value: '1' },
      { category: 'identity', key: 'b', value: '2' },
      { category: 'person', key: 'c', value: '3' },
      { category: 'insight', key: 'd', value: '4' },
    ]);
    const c = getContextHintCounts(db);
    expect(c.knowledge_total).toBe(4);
    expect(c.knowledge_by_category.identity).toBe(2);
    expect(c.knowledge_by_category.person).toBe(1);
    expect(c.knowledge_by_category.insight).toBe(1);
    expect(c.knowledge_by_category.routine).toBe(0);
  });
});
