// src-v3/utils/memory-op-executor.ts

import type { UserDb } from '../db/user-db.js';
import type { ExtractionOp } from './extraction-prompt.js';

export interface ExecResult {
  executed: number;
  skipped: number;
  errors: string[];
}

/**
 * Dispatch extracted memory ops to the UserDb's stores.
 * Non-fatal: malformed ops are skipped with error logged, execution continues.
 * source_msg_id is attached so memory entries can link back to the first session message.
 */
export function executeMemoryOps(
  userDb: UserDb,
  ops: ExtractionOp[],
  sourceMsgId: string,
  sessionPseudoId: string
): ExecResult {
  const result: ExecResult = { executed: 0, skipped: 0, errors: [] };

  for (const op of ops) {
    try {
      dispatch(userDb, op, sourceMsgId, sessionPseudoId);
      result.executed++;
    } catch (err) {
      result.skipped++;
      result.errors.push(`${op.op}: ${String(err).slice(0, 150)}`);
    }
  }

  return result;
}

function dispatch(userDb: UserDb, op: ExtractionOp, sourceMsgId: string, sessionPseudoId: string): void {
  switch (op.op) {
    case 'save_profile': {
      const { category, layer, key, value, confidence, importance } = op as any;
      if (!category || !layer || !key || !value) throw new Error('missing required field');
      userDb.memory.upsertProfile({
        category, layer, key, value,
        confidence: typeof confidence === 'number' ? confidence : null,
        source_session_id: sessionPseudoId,
        source_msg_id: sourceMsgId,
        importance: importance === 'critical' || importance === 'normal' ? importance : null,
      });
      break;
    }
    case 'save_relationship': {
      const { name, role, dynamic, circle, related_ids } = op as any;
      if (!name || !role) throw new Error('missing name/role');
      const validCircles = ['inner', 'extended_family', 'close', 'casual'];
      userDb.memory.upsertRelationship({
        name, role,
        dynamic: dynamic ?? null,
        circle: validCircles.includes(circle) ? circle : null,
        related_ids: Array.isArray(related_ids) ? related_ids : null,
        source_session_id: sessionPseudoId,
      });
      break;
    }
    case 'save_journal': {
      const { type, content, status, intensity, event_date, recurrence_count } = op as any;
      if (!type || !content) throw new Error('missing type/content');
      userDb.memory.insertJournal({
        type,
        content,
        status: status ?? null,
        intensity: intensity ?? null,
        recurrence_count: typeof recurrence_count === 'number' ? recurrence_count : 1,
        related_ids: null,
        event_date: event_date ?? null,
        event_outcome: null,
        follow_up_needed: 0,
        inferred_trait: null,
        confidence: null,
        session_id: sessionPseudoId,
        source_msg_id: sourceMsgId,
        resolved_at: null,
      });
      break;
    }
    case 'save_trait_observation': {
      const { inferred_trait, confidence, content } = op as any;
      if (!inferred_trait || typeof confidence !== 'number' || !content) {
        throw new Error('missing inferred_trait/confidence/content');
      }
      userDb.memory.insertJournal({
        type: 'trait_observation',
        content,
        status: null,
        intensity: null,
        recurrence_count: 1,
        related_ids: null,
        event_date: null,
        event_outcome: null,
        follow_up_needed: 0,
        inferred_trait,
        confidence,
        session_id: sessionPseudoId,
        source_msg_id: sourceMsgId,
        resolved_at: null,
      });
      break;
    }
    case 'save_conversation_summary': {
      const { content } = op as any;
      if (!content) throw new Error('missing content');
      userDb.memory.insertJournal({
        type: 'conversation_summary',
        content,
        status: null,
        intensity: null,
        recurrence_count: 1,
        related_ids: null,
        event_date: null,
        event_outcome: null,
        follow_up_needed: 0,
        inferred_trait: null,
        confidence: null,
        session_id: sessionPseudoId,
        source_msg_id: sourceMsgId,
        resolved_at: null,
      });
      break;
    }
    default:
      throw new Error(`unknown op type: ${op.op}`);
  }
}
