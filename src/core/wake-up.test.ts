import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserDb, type UserDb } from '../db/user-db.js';
import { buildWakeUpBriefing, renderWakeUpBriefing, computeLastUserMsgGap } from './wake-up.js';

describe('renderWakeUpBriefing', () => {
  let tmp: string; let db: UserDb;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'v5-wu-')); db = createUserDb('u', tmp); });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('renders empty profile and zero counts on fresh user', () => {
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date('2026-04-22T10:30:00+07:00'),
      timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('<profile>');
    expect(out).toContain('</profile>');
    expect(out).toContain('Active tasks: 0');
    expect(out).toContain('Knowledge: 0 entries');
  });

  it('renders populated profile slots in fixed order', () => {
    db.profile.setMany([
      { key: 'name', value: 'Mirza' },
      { key: 'language', value: 'id' },
      { key: 'timezone', value: 'Asia/Seoul' },
    ]);
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    const nameIdx = out.indexOf('name: "Mirza"');
    const langIdx = out.indexOf('language: "id"');
    const tzIdx = out.indexOf('timezone: "Asia/Seoul"');
    expect(nameIdx).toBeGreaterThan(-1);
    expect(langIdx).toBeGreaterThan(nameIdx);
    expect(tzIdx).toBeGreaterThan(langIdx);
  });

  it('groups preferences by kind', () => {
    db.preferences.saveMany([
      { kind: 'rule', key: 'food_halal', value: 'halal only' },
      { kind: 'style', key: 'casual_register', value: 'friendly' },
    ]);
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('Rules (must observe):');
    expect(out).toContain('- food_halal: halal only');
    expect(out).toContain('Style (how to communicate & interact):');
    expect(out).toContain('- casual_register: friendly');
  });

  it('renders knowledge breakdown by category', () => {
    db.knowledge.saveMany([
      { category: 'identity', key: 'a', value: '1' },
      { category: 'person', key: 'b', value: '2' },
      { category: 'person', key: 'c', value: '3' },
    ]);
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toMatch(/Knowledge: 3 entries — identity: 1, person: 2, routine: 0, context: 0, insight: 0/);
  });

  it('omits last_user_msg_gap attribute when no user message exists', () => {
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).not.toContain('last_user_msg_gap');
  });

  it('always renders <recent_messages> block (empty on fresh user)', () => {
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('<recent_messages count="0">');
    expect(out).not.toContain('<last_session_summary');
  });

  it('renders recent messages verbatim in chronological order with timestamps', () => {
    const t0 = Date.UTC(2026, 3, 22, 10, 0, 0);
    db.messages.insert({
      id: 'm1', gateway: 'console', session_id: null,
      sender: 'user', timestamp: t0, type: 'text', body: 'Halo',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null, quoted_msg_id: null,
      is_forwarded: 0, raw_json: null,
    });
    db.messages.insert({
      id: 'm2', gateway: 'console', session_id: null,
      sender: 'assistant', timestamp: t0 + 60_000, type: 'text', body: 'Hai!',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null, quoted_msg_id: null,
      is_forwarded: 0, raw_json: null,
    });
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('<recent_messages count="2">');
    const haloIdx = out.indexOf('Halo');
    const haiIdx = out.indexOf('Hai!');
    expect(haloIdx).toBeGreaterThan(-1);
    expect(haiIdx).toBeGreaterThan(haloIdx);
    expect(out).toContain(`ts="${new Date(t0).toISOString()}"`);
    expect(out).toContain('from="user"');
    expect(out).toContain('from="assistant"');
  });

  it('honors custom recentMessagesCount limit', () => {
    for (let i = 0; i < 5; i++) {
      db.messages.insert({
        id: `m${i}`, gateway: 'console', session_id: null,
        sender: 'user', timestamp: Date.now() + i, type: 'text', body: `msg-${i}`,
        has_media: 0, media_mimetype: null, media_filename: null,
        media_size: null, media_path: null, quoted_msg_id: null,
        is_forwarded: 0, raw_json: null,
      });
    }
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
      recentMessagesCount: 2,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('<recent_messages count="2">');
    expect(out).toContain('msg-3');
    expect(out).toContain('msg-4');
    expect(out).not.toContain('msg-0');
  });

  it('escapes XML special characters in recent message bodies', () => {
    db.messages.insert({
      id: 'm2', gateway: 'console', session_id: null,
      sender: 'user', timestamp: Date.now(), type: 'text', body: 'a & b <c>',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null, quoted_msg_id: null,
      is_forwarded: 0, raw_json: null,
    });
    const data = buildWakeUpBriefing({
      userId: 'u', now: new Date(), timezone: 'Asia/Jakarta', userDb: db,
    });
    const out = renderWakeUpBriefing(data);
    expect(out).toContain('a &amp; b &lt;c&gt;');
    expect(out).not.toContain('a & b <c>');
  });
});

describe('computeLastUserMsgGap', () => {
  let tmp: string; let db: UserDb;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'v5-gap-')); db = createUserDb('u', tmp); });
  afterEach(() => { db.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('returns null when no user messages exist', () => {
    expect(computeLastUserMsgGap(db, new Date())).toBeNull();
  });

  it('formats gap as minutes when under an hour', () => {
    const now = new Date('2026-04-22T10:30:00Z');
    const threeMinAgo = now.getTime() - 3 * 60 * 1000;
    db.messages.insert({
      id: 'm1', gateway: 'console', session_id: null,
      sender: 'user', timestamp: threeMinAgo, type: 'text', body: 'hi',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null, quoted_msg_id: null,
      is_forwarded: 0, raw_json: null,
    });
    expect(computeLastUserMsgGap(db, now)).toBe('3m');
  });

  it('formats gap as hours+minutes when under a day', () => {
    const now = new Date('2026-04-22T10:30:00Z');
    const ago = now.getTime() - (19 * 60 + 52) * 60 * 1000;
    db.messages.insert({
      id: 'm2', gateway: 'console', session_id: null,
      sender: 'user', timestamp: ago, type: 'text', body: 'hi',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null, quoted_msg_id: null,
      is_forwarded: 0, raw_json: null,
    });
    expect(computeLastUserMsgGap(db, now)).toBe('19h 52m');
  });

  it('formats gap as days+hours when >= a day', () => {
    const now = new Date('2026-04-22T10:30:00Z');
    const ago = now.getTime() - (3 * 24 + 14) * 60 * 60 * 1000;
    db.messages.insert({
      id: 'm3', gateway: 'console', session_id: null,
      sender: 'user', timestamp: ago, type: 'text', body: 'hi',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null, quoted_msg_id: null,
      is_forwarded: 0, raw_json: null,
    });
    expect(computeLastUserMsgGap(db, now)).toBe('3d 14h');
  });

  it('ignores non-user messages for gap calculation', () => {
    db.messages.insert({
      id: 'm-ai', gateway: 'console', session_id: null,
      sender: 'assistant', timestamp: Date.now() - 60 * 1000, type: 'text', body: 'reply',
      has_media: 0, media_mimetype: null, media_filename: null,
      media_size: null, media_path: null, quoted_msg_id: null,
      is_forwarded: 0, raw_json: null,
    });
    expect(computeLastUserMsgGap(db, new Date())).toBeNull();
  });
});
