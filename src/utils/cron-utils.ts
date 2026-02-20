import { CronExpressionParser } from 'cron-parser';
import { TIMEZONE } from '../core/constants.js';

export function computeMissedExecutionTimes(cronExpr: string, fromMs: number, toMs: number): number[] {
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
