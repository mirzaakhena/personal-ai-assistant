// scripts/migrate-wa-extract.ts
// One-shot, single-user clean-slate migration:
//   fromserver/whatsapp_extract.db  →  data/users/1121398977/app.db
// Replaces the obsolete pre-M3.5 version. Per-user schema (M3.5 + M5).

import Database from 'better-sqlite3';
import { mkdirSync, existsSync, copyFileSync } from 'fs';
import { basename } from 'path';
import { createUserDb } from '../src-v3/db/user-db.js';
import type { MessageRecord, Sender } from '../src-v3/db/message.js';

// ── Configuration (hardcoded, single-user one-shot) ─────────
const SOURCE_DB        = 'fromserver/whatsapp_extract.db';
const SOURCE_MEDIA_DIR = 'fromserver/whatsapp_media';
const TARGET_USER_ID   = '1121398977';
const SOURCE_PHONE     = '6281321127717';
const TARGET_MEDIA_DIR = `data/users/${TARGET_USER_ID}/media`;
const GATEWAY_VALUE    = 'telegram';

const SKIP_TYPES = new Set(['revoked', 'ciphertext', 'call_log']);

const TYPE_NORMALIZE: Record<string, string> = {
  chat: 'text',
  album: 'image',
};
// Other types preserved as-is: image, document, audio, video, pinned_message.

// ── Source row shape ─────────────────────────────────────────
interface SourceRow {
  id: string;
  chat_id: string;
  phone_number: string;
  from_me: number;
  timestamp: number;            // seconds since epoch
  type: string;
  body: string | null;
  has_media: number;
  media_mimetype: string | null;
  media_filename: string | null;
  media_size: number | null;
  media_downloaded: number;
  media_path: string | null;
  media_error: string | null;
  quoted_msg_id: string | null;
  is_forwarded: number;
  raw_json: string;
}

// ── Migration ───────────────────────────────────────────────
function migrate(): void {
  if (!existsSync(SOURCE_DB)) {
    console.error(`ERROR: source DB not found: ${SOURCE_DB}`);
    process.exit(1);
  }

  const start = Date.now();

  console.log('=== WA Extract Re-Migration ===');
  console.log(`Source DB:    ${SOURCE_DB}`);
  console.log(`Source media: ${SOURCE_MEDIA_DIR}${existsSync(SOURCE_MEDIA_DIR) ? '' : ' (missing — media will be skipped)'}`);
  console.log(`Target user:  ${TARGET_USER_ID}`);
  console.log(`Target DB:    data/users/${TARGET_USER_ID}/app.db`);
  console.log(`Target media: ${TARGET_MEDIA_DIR}`);
  console.log('');
  console.log(`Phone filter: ${SOURCE_PHONE}`);
  console.log(`Skip types:   ${[...SKIP_TYPES].join(', ')}`);
  console.log(`Type normalization: ${Object.entries(TYPE_NORMALIZE).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
  console.log('');

  const userDb = createUserDb(TARGET_USER_ID);
  mkdirSync(TARGET_MEDIA_DIR, { recursive: true });

  const preExistingCount = userDb.messages.count();
  console.log(`Pre-existing message count: ${preExistingCount}`);

  const source = new Database(SOURCE_DB, { readonly: true });
  const rows = source.prepare('SELECT * FROM messages ORDER BY timestamp ASC').all() as SourceRow[];

  console.log(`Processing ${rows.length} source rows...`);
  console.log('');

  let skippedType = 0;
  let skippedPhone = 0;
  let attempted = 0;
  let mediaCopied = 0;
  let mediaAlreadyExists = 0;
  let mediaMissing = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      if (SKIP_TYPES.has(row.type)) {
        skippedType++;
        continue;
      }
      if (row.phone_number !== SOURCE_PHONE) {
        skippedPhone++;
        continue;
      }

      const normalizedType = TYPE_NORMALIZE[row.type] ?? row.type;
      const sender: Sender = row.from_me === 1 ? 'assistant' : 'user';
      const timestampMs = row.timestamp * 1000;

      // Media handling
      let outHasMedia = row.has_media;
      let outMediaPath: string | null = null;
      if (row.has_media === 1 && row.media_path) {
        const fileName = basename(row.media_path);
        const sourceAbs = `${SOURCE_MEDIA_DIR}/${fileName}`;
        const destAbs = `${TARGET_MEDIA_DIR}/${fileName}`;
        if (existsSync(sourceAbs)) {
          if (existsSync(destAbs)) {
            mediaAlreadyExists++;
          } else {
            try {
              copyFileSync(sourceAbs, destAbs);
              mediaCopied++;
            } catch (err) {
              console.warn(`  WARN media copy failed for ${fileName}: ${String(err)}`);
              mediaMissing++;
              outHasMedia = 0;
            }
          }
          if (outHasMedia === 1) {
            outMediaPath = destAbs;
          }
        } else {
          mediaMissing++;
          outHasMedia = 0;
        }
      }

      const bodyTrimmed = row.body ? row.body.trim() : null;
      const bodyOrNull = bodyTrimmed && bodyTrimmed.length > 0 ? bodyTrimmed : null;

      const record: MessageRecord = {
        id: row.id,
        gateway: GATEWAY_VALUE,
        session_id: null,
        sender,
        timestamp: timestampMs,
        type: normalizedType,
        body: bodyOrNull,
        has_media: outHasMedia,
        media_mimetype: row.media_mimetype,
        media_filename: row.media_filename,
        media_size: row.media_size,
        media_path: outMediaPath,
        quoted_msg_id: row.quoted_msg_id,
        is_forwarded: row.is_forwarded,
        raw_json: row.raw_json,
      };

      userDb.messages.insert(record);
      attempted++;
    } catch (err) {
      console.error(`  ERROR processing row ${row.id}: ${String(err)}`);
      errors++;
    }
  }

  source.close();

  const postCount = userDb.messages.count();
  const newInserts = postCount - preExistingCount;
  const alreadyExisted = attempted - newInserts;

  // Type distribution
  const db = new Database(`data/users/${TARGET_USER_ID}/app.db`, { readonly: true });
  const typeDistRows = db
    .prepare(`SELECT type, COUNT(*) AS n FROM messages GROUP BY type ORDER BY n DESC`)
    .all() as { type: string; n: number }[];
  db.close();

  userDb.close();

  console.log('Summary:');
  console.log(`  Total source rows:        ${rows.length}`);
  console.log(`  Skipped (type):           ${skippedType}`);
  console.log(`  Skipped (phone mismatch): ${skippedPhone}`);
  console.log(`  Attempted insert:         ${attempted}`);
  console.log(`  New inserts:              ${newInserts}`);
  console.log(`  Already existed (dedup):  ${alreadyExisted}`);
  if (errors > 0) console.log(`  Row errors:               ${errors}`);
  console.log('');
  console.log('Media:');
  console.log(`  Files copied (new):              ${mediaCopied}`);
  console.log(`  Files already in target (skip):  ${mediaAlreadyExists}`);
  console.log(`  Files missing in source:         ${mediaMissing}`);
  console.log('');
  console.log('Type distribution after migration:');
  for (const r of typeDistRows) {
    console.log(`  ${r.type.padEnd(16)} ${r.n}`);
  }
  console.log('');
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s.`);
}

migrate();
