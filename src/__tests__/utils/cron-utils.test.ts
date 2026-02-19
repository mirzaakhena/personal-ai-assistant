import { describe, expect, it } from 'vitest';
import { computeMissedExecutionTimes } from '../../utils/cron-utils.js';

// All fixed timestamps use WIB (UTC+7 = Asia/Jakarta)
// Dec 31, 2025 17:00:00 UTC = Jan 1, 2026 00:00:00 WIB
const JAN_1_2026_00_WIB = 1767200400000;
// Jan 2, 2026 17:00:00 UTC = Jan 3, 2026 00:00:00 WIB
const JAN_3_2026_00_WIB = 1767373200000;

describe('computeMissedExecutionTimes', () => {
  it('returns empty array for a 1-minute window with hourly cron', () => {
    const fromMs = JAN_1_2026_00_WIB; // starts at :00:00
    const toMs = fromMs + 60_000;      // 1 minute later
    const result = computeMissedExecutionTimes('0 * * * *', fromMs, toMs);
    expect(result).toEqual([]);
  });

  it('returns 2 results for a 3-hour window with hourly cron', () => {
    const fromMs = JAN_1_2026_00_WIB;
    const toMs = fromMs + 3 * 3_600_000;
    const result = computeMissedExecutionTimes('0 * * * *', fromMs, toMs);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('all results are strictly less than toMs', () => {
    const fromMs = JAN_1_2026_00_WIB;
    const toMs = fromMs + 3 * 3_600_000;
    const result = computeMissedExecutionTimes('0 * * * *', fromMs, toMs);
    for (const ms of result) {
      expect(ms).toBeLessThan(toMs);
    }
  });

  it('results are in ascending order', () => {
    const fromMs = JAN_1_2026_00_WIB;
    const toMs = fromMs + 3 * 3_600_000;
    const result = computeMissedExecutionTimes('0 * * * *', fromMs, toMs);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it('returns exactly 2 results for 48-hour window with daily 9am WIB cron', () => {
    // Jan 1 2026 00:00 WIB → Jan 3 2026 00:00 WIB
    const result = computeMissedExecutionTimes('0 9 * * *', JAN_1_2026_00_WIB, JAN_3_2026_00_WIB);
    expect(result).toHaveLength(2);
    // Each result should be at 02:00 UTC (= 09:00 WIB)
    for (const ms of result) {
      const d = new Date(ms);
      expect(d.getUTCHours()).toBe(2);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
    }
  });
});
