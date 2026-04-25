// src/tools/ledger.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { LedgerStore, LedgerRecord } from '../db/ledger.js';

export interface LedgerHandlers {
  appendLedger(rec: {
    stream: string;
    payload: unknown;
    tags?: string[];
    ts?: number;
    source_msg_id?: string;
  }): LedgerRecord;
  queryLedger(sql: string): Record<string, unknown>[];
}

export function createLedgerHandlers(store: LedgerStore): LedgerHandlers {
  return {
    appendLedger: (rec) => store.append(rec),
    queryLedger: (sql) => store.query(sql),
  };
}

const AppendInput = {
  stream: z.string().min(1).max(60),
  payload: z.record(z.string(), z.unknown()),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  ts: z.number().int().nonnegative().optional(),
  source_msg_id: z.string().optional(),
};

const QueryInput = {
  sql: z.string().min(1).max(2000),
};

export function createLedgerMcpServer(h: LedgerHandlers) {
  return createSdkMcpServer({
    name: 'ledger',
    version: '1.0.0',
    tools: [
      tool(
        'ledger_append',
        "Record a structured time-series entry. `stream` is a kebab-case " +
          "name (e.g. 'expense', 'mood', 'sleep') whose JSON payload schema " +
          "is owned by a skill the user has installed. Use `tags` for " +
          "searchable secondary axes. Pass `ts` only to backdate; default " +
          "is now.",
        AppendInput,
        async (rec) => ({
          content: [{ type: 'text' as const, text: JSON.stringify(h.appendLedger(rec)) }],
        })
      ),
      tool(
        'ledger_query',
        "Run a SELECT-only SQLite query against the ledger table. The table " +
          "schema is: id TEXT, ts INTEGER (ms epoch), stream TEXT, payload " +
          "TEXT (JSON), tags TEXT (space-separated), source_msg_id TEXT, " +
          "created_at INTEGER. Use `json_extract(payload, '$.field')` to " +
          "read inside the payload. Multi-statement queries, DDL, DML, " +
          "PRAGMA, and ATTACH are rejected.",
        QueryInput,
        async ({ sql }) => ({
          content: [{ type: 'text' as const, text: JSON.stringify(h.queryLedger(sql), null, 2) }],
        })
      ),
    ],
  });
}
