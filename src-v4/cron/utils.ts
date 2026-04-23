// src-v4/cron/utils.ts

import { CronExpressionParser } from 'cron-parser';
import { TIMEZONE } from '../utils/model-config.js';

/**
 * Compute all cron execution times between fromMs (exclusive) and toMs (exclusive).
 * Used on startup to identify missed executions for recurring jobs.
 */
export function computeMissedExecutionTimes(
  cronExpr: string,
  fromMs: number,
  toMs: number,
): number[] {
  const results: number[] = [];
  const interval = CronExpressionParser.parse(cronExpr, {
    currentDate: new Date(fromMs),
    tz: TIMEZONE,
  });
  while (true) {
    const next = interval.next();
    const ms = next.getTime();
    if (ms >= toMs) break;
    results.push(ms);
  }
  return results;
}
