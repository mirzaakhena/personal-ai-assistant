import { getMemoryDb, rid, extractItems } from '../../db/memory.js';
import {
  MEMORY_PROMOTION_ACCESS_THRESHOLD,
  MEMORY_DEMOTION_INACTIVE_DAYS,
} from '../../core/constants.js';
import { EDGE_TABLE_MAP, type MemoryTable } from './shared.js';

export interface ImportanceSuggestion {
  record_id: string;
  table: string;
  current_importance: string;
  suggested_importance: string;
  reason: string;
}

/**
 * Get suggestions for promoting or demoting memory importance levels.
 * - Extended memories with access_count >= threshold → suggest promotion to fundamental
 * - Fundamental memories not accessed in 30+ days → suggest demotion to extended
 */
export async function getImportanceSuggestions(
  phoneNumber: string,
): Promise<ImportanceSuggestion[]> {
  const db = getMemoryDb();
  const suggestions: ImportanceSuggestion[] = [];

  const selfResult = await db.query<[Array<{ id: unknown }>]>(
    `SELECT id FROM person WHERE phone = $phone AND type = 'self'`,
    { phone: phoneNumber },
  );
  if (!selfResult[0] || selfResult[0].length === 0) return [];

  const selfId = String(selfResult[0][0]!.id);

  const memoryTables: MemoryTable[] = ['preference', 'fact', 'routine'];

  for (const table of memoryTables) {
    const edgeTable = EDGE_TABLE_MAP[table]!;

    const queryResult = await db.query<[Array<Record<string, unknown>>]>(
      `SELECT ->${edgeTable}->${table}.* AS items FROM $selfId`,
      { selfId: rid(selfId) },
    );
    const items = extractItems(queryResult);

    for (const item of items) {
      if (item.superseded_by) continue;

      const recordId = String(item.id);
      const importance = item.importance as string | undefined;
      const accessCount = (item.access_count as number) ?? 0;

      // Promotion: extended with high access count
      if (
        importance === 'extended' &&
        accessCount >= MEMORY_PROMOTION_ACCESS_THRESHOLD
      ) {
        suggestions.push({
          record_id: recordId,
          table,
          current_importance: 'extended',
          suggested_importance: 'fundamental',
          reason: `Accessed ${accessCount} times (threshold: ${MEMORY_PROMOTION_ACCESS_THRESHOLD})`,
        });
      }

      // Demotion: fundamental not accessed recently
      if (importance === 'fundamental') {
        const lastAccessed = item.last_accessed as
          | Date
          | string
          | undefined;
        if (lastAccessed) {
          let lastMs: number;
          if (lastAccessed instanceof Date) {
            lastMs = lastAccessed.getTime();
          } else if (
            typeof lastAccessed === 'object' &&
            lastAccessed !== null &&
            'getTime' in lastAccessed &&
            typeof (lastAccessed as { getTime: unknown }).getTime === 'function'
          ) {
            lastMs = (lastAccessed as { getTime(): number }).getTime();
          } else {
            lastMs = new Date(String(lastAccessed)).getTime();
          }

          if (!isNaN(lastMs)) {
            const daysSinceAccess =
              (Date.now() - lastMs) / (1000 * 60 * 60 * 24);
            if (daysSinceAccess >= MEMORY_DEMOTION_INACTIVE_DAYS) {
              suggestions.push({
                record_id: recordId,
                table,
                current_importance: 'fundamental',
                suggested_importance: 'extended',
                reason: `Not accessed for ${Math.floor(daysSinceAccess)} days (threshold: ${MEMORY_DEMOTION_INACTIVE_DAYS})`,
              });
            }
          }
        }
      }
    }
  }

  return suggestions;
}
