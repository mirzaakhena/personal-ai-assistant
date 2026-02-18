import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';

mkdirSync('data', { recursive: true });

const db = new Database('data/sessions.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    phone_number TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

const stmtGet = db.prepare<[string], { session_id: string }>(
  'SELECT session_id FROM sessions WHERE phone_number = ?'
);

const stmtUpsert = db.prepare(
  `INSERT INTO sessions (phone_number, session_id, updated_at)
   VALUES (?, ?, ?)
   ON CONFLICT(phone_number) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`
);

export function getSessionId(phoneNumber: string): string | undefined {
  const row = stmtGet.get(phoneNumber);
  return row?.session_id;
}

export function saveSessionId(phoneNumber: string, sessionId: string): void {
  stmtUpsert.run(phoneNumber, sessionId, Date.now());
}
