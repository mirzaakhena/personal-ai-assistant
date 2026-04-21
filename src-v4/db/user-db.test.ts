// src-v4/db/user-db.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserDb, getCoreIdentity, getContextHintCounts, type UserDb } from './user-db.js';

describe('getCoreIdentity', () => {
  let tmp: string;
  let db: UserDb;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v4-ud-ci-'));
    db = createUserDb('u-test', tmp);
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns name, current_location, language when present', () => {
    db.memory.upsertProfile({
      category: 'identity', layer: 'L3', key: 'name', value: 'Mirza',
      confidence: null, source_session_id: null, source_msg_id: null,
    });
    db.memory.upsertProfile({
      category: 'location', layer: 'L3', key: 'current', value: 'Jakarta',
      confidence: null, source_session_id: null, source_msg_id: null,
    });
    db.memory.upsertProfile({
      category: 'preference', layer: 'L3', key: 'language', value: 'id',
      confidence: null, source_session_id: null, source_msg_id: null,
    });

    const id = getCoreIdentity(db);
    expect(id.name).toBe('Mirza');
    expect(id.current_location).toBe('Jakarta');
    expect(id.language).toBe('id');
  });

  it('omits fields when not present (no allergy leaks in)', () => {
    db.memory.upsertProfile({
      category: 'identity', layer: 'L3', key: 'name', value: 'Ana',
      confidence: null, source_session_id: null, source_msg_id: null,
    });
    db.memory.upsertProfile({
      category: 'rule', layer: 'L3', key: 'allergy_food', value: 'udang',
      confidence: null, source_session_id: null, source_msg_id: null, importance: 'critical' as const,
    });

    const id = getCoreIdentity(db);
    expect(id.name).toBe('Ana');
    expect(id.current_location).toBeUndefined();
    expect(id.language).toBeUndefined();
    // Allergy must NOT leak in as an arbitrary key
    expect(Object.keys(id)).toEqual(['name']);
  });

  it('returns empty object when no L3 profile entries', () => {
    expect(getCoreIdentity(db)).toEqual({});
  });
});

describe('getContextHintCounts', () => {
  let tmp: string;
  let db: UserDb;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'v4-ud-ch-'));
    db = createUserDb('u-test', tmp);
  });
  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns zero counts for empty DB', () => {
    const c = getContextHintCounts(db);
    expect(c).toEqual({ ongoing: 0, tasks: 0, habits: 0, relationships: 0 });
  });

  it('counts ongoing journals, pending tasks, active habits, relationships', () => {
    // One ongoing journal
    db.memory.insertJournal({
      type: 'problem', content: 'stuck on X', status: 'ongoing',
      intensity: null, recurrence_count: 1, related_ids: null,
      event_date: null, event_outcome: null, follow_up_needed: 0,
      inferred_trait: null, confidence: null,
      session_id: null, source_msg_id: null, resolved_at: null,
    });
    // Two pending tasks
    db.tasks.insert({
      type: 'errand', title: 'beli lampu', status: 'pending', priority: 'medium',
      trigger_keywords: [], due_date: null, notes: null, related_ids: null,
    });
    db.tasks.insert({
      type: 'errand', title: 'kirim dokumen', status: 'pending', priority: 'medium',
      trigger_keywords: [], due_date: null, notes: null, related_ids: null,
    });
    // One active habit
    db.habits.insert({
      title: 'minum air', status: 'active',
      cadence_type: 'count', cadence_config: { target: 8, period: 'day' },
      notes: null,
    });
    // One relationship
    db.memory.upsertRelationship({
      name: 'Ibu', role: 'parent', dynamic: null, circle: 'inner',
      related_ids: null, source_session_id: null,
    });

    const c = getContextHintCounts(db);
    expect(c.ongoing).toBe(1);
    expect(c.tasks).toBe(2);
    expect(c.habits).toBe(1);
    expect(c.relationships).toBe(1);
  });
});
