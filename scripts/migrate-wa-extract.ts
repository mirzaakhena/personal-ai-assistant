// scripts/migrate-wa-extract.ts
// One-time migration: WhatsApp extract → v3 message store

import Database from 'better-sqlite3';
import {
  mkdirSync,
  existsSync,
  copyFileSync,
} from 'fs';
import { basename } from 'path';
import { createMessageStore, type MessageRecord, type Sender } from '../src-v3/db/message.js';

// ── Configuration ───────────────────────────────────────────
const SOURCE_DB = 'fromserver/whatsapp_extract.db';
const SOURCE_MEDIA_DIR = 'fromserver/whatsapp_media';
const TARGET_MESSAGE_DB = 'data/message.db';
const TARGET_MEDIA_DIR = 'data/media';

/** Phone number → Telegram chat_id mapping */
const USER_ID_MAP: Record<string, string> = {
  '6281321127717': '1121398977',
};

const GATEWAY_VALUE = 'telegram';

const SKIP_TYPES = new Set(['revoked', 'ciphertext', 'call_log']);

const TYPE_NORMALIZE: Record<string, string> = {
  chat: 'text',
  album: 'image',
};
// Other types (image, document, audio, video, pinned_message) preserved as-is.

// ── Source row type ─────────────────────────────────────────
interface SourceRow {
  id: string;
  chat_id: string;
  phone_number: string;
  from_me: number;
  timestamp: number;
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

  console.log('=== WA Extract Migration ===');
  console.log(`Source DB:    ${SOURCE_DB}`);
  console.log(`Source media: ${SOURCE_MEDIA_DIR}${existsSync(SOURCE_MEDIA_DIR) ? '' : ' (missing — media will be skipped)'}`);
  console.log(`Target DB:    ${TARGET_MESSAGE_DB}`);
  console.log(`Target media: ${TARGET_MEDIA_DIR}`);
  console.log('');
  console.log('User mapping:');
  for (const [from, to] of Object.entries(USER_ID_MAP)) {
    console.log(`  ${from} → ${to} (gateway=${GATEWAY_VALUE})`);
  }
  console.log('');
  console.log(`Skip types: ${[...SKIP_TYPES].join(', ')}`);
  console.log(`Type normalization: ${Object.entries(TYPE_NORMALIZE).map(([k, v]) => `${k} → ${v}`).join(', ')}`);
  console.log('');

  mkdirSync(TARGET_MEDIA_DIR, { recursive: true });

  const source = new Database(SOURCE_DB, { readonly: true });
  const messageStore = createMessageStore(TARGET_MESSAGE_DB);

  const rows = source.prepare('SELECT * FROM messages ORDER BY timestamp ASC').all() as SourceRow[];

  console.log(`Processing ${rows.length} rows...`);

  let skippedType = 0;
  let skippedUnmapped = 0;
  let attempted = 0;
  let mediaCopied = 0;
  let mediaAlreadyExists = 0;
  let mediaMissing = 0;
  let errors = 0;

  const preDb = new Database(TARGET_MESSAGE_DB, { readonly: true });
  const preExistingCount = (preDb.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  preDb.close();

  for (const row of rows) {
    try {
      if (SKIP_TYPES.has(row.type)) {
        skippedType++;
        continue;
      }
      const mappedUserId = USER_ID_MAP[row.phone_number];
      if (!mappedUserId) {
        skippedUnmapped++;
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
            outMediaPath = `${TARGET_MEDIA_DIR}/${fileName}`;
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
        user_id: mappedUserId,
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

      messageStore.insert(record);
      attempted++;
    } catch (err) {
      console.error(`  ERROR processing row ${row.id}: ${String(err)}`);
      errors++;
    }
  }

  source.close();

  const postDb = new Database(TARGET_MESSAGE_DB, { readonly: true });
  const postCount = (postDb.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
  const newInserts = postCount - preExistingCount;
  const alreadyExisted = attempted - newInserts;

  // Type distribution for migrated user(s)
  const targetUserIds = Object.values(USER_ID_MAP);
  const placeholders = targetUserIds.map(() => '?').join(',');
  const typeDistRows = postDb
    .prepare(`SELECT type, COUNT(*) AS n FROM messages WHERE user_id IN (${placeholders}) GROUP BY type ORDER BY n DESC`)
    .all(...targetUserIds) as { type: string; n: number }[];
  postDb.close();

  console.log('');
  console.log('Summary:');
  console.log(`  Total source rows:       ${rows.length}`);
  console.log(`  Skipped (type):          ${skippedType}`);
  console.log(`  Skipped (unmapped user): ${skippedUnmapped}`);
  console.log(`  Attempted insert:        ${attempted}`);
  console.log(`  New inserts:             ${newInserts}`);
  console.log(`  Already existed (dedup): ${alreadyExisted}`);
  if (errors > 0) console.log(`  Row errors:              ${errors}`);
  console.log('');
  console.log('Media:');
  console.log(`  Files copied (new):               ${mediaCopied}`);
  console.log(`  Files already in target (skip):   ${mediaAlreadyExists}`);
  console.log(`  Files missing in source:          ${mediaMissing}`);
  console.log('');
  console.log('Type distribution for migrated user(s):');
  for (const r of typeDistRows) {
    console.log(`  ${r.type.padEnd(16)} ${r.n}`);
  }
  console.log('');
  console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s.`);
}

migrate();
