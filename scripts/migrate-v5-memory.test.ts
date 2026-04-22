import { describe, it, expect } from 'vitest';
import {
  deriveProfileFromLegacy,
  buildPreferenceSeeds,
  buildKnowledgeSeedsFromLegacyProfile,
  buildKnowledgeSeedsFromLegacyRelationships,
  buildKnowledgeSeedsFromLegacyHabits,
  slugifyContent,
  type LegacyProfileRow,
  type LegacyRelationshipRow,
  type LegacyHabitRow,
} from './migrate-v5-memory.js';

describe('deriveProfileFromLegacy', () => {
  it('maps name/location/language from canonical keys', () => {
    const rows: LegacyProfileRow[] = [
      { category: 'identity', layer: 'L3', key: 'name', value: 'Mirza' },
      { category: 'identity', layer: 'L3', key: 'location', value: 'Bandung' },
      { category: 'identity', layer: 'L3', key: 'lokasi_saat_ini', value: 'Busan' },
      { category: 'identity', layer: 'L3', key: 'jam_aktif', value: '04:30-22:00 WIB' },
      { category: 'preference', layer: 'L2', key: 'bahasa_komunikasi', value: 'Bahasa Indonesia — ...' },
      { category: 'rule', layer: 'L2', key: 'timezone_preference', value: 'KST (Asia/Seoul)' },
    ];
    const p = deriveProfileFromLegacy(rows);
    expect(p.name).toBe('Mirza');
    expect(p.home_location).toBe('Bandung');
    expect(p.current_location).toBe('Busan');
    expect(p.active_hours).toBe('04:30-22:00 WIB');
    expect(p.language).toBe('id');
    expect(p.timezone).toBe('Asia/Seoul');
  });

  it('defaults called_as to "Mirz"', () => {
    const p = deriveProfileFromLegacy([]);
    expect(p.called_as).toBe('Mirz');
  });
});

describe('buildPreferenceSeeds', () => {
  it('returns exactly 10 rows grouped by kind', () => {
    const rows: LegacyProfileRow[] = []; // seeds are hardcoded from spec
    const seeds = buildPreferenceSeeds(rows);
    expect(seeds).toHaveLength(10);
    expect(seeds.filter(s => s.kind === 'rule')).toHaveLength(3);
    expect(seeds.filter(s => s.kind === 'style')).toHaveLength(7);
  });
});

describe('slugifyContent', () => {
  it('produces lowercase snake_case from a prefix', () => {
    expect(slugifyContent('Mirza punya ide product: QR ordering', 40))
      .toBe('mirza_punya_ide_product_qr_ordering');
  });

  it('handles non-ASCII by stripping diacritics', () => {
    expect(slugifyContent('kacamata kotak — hitam dan putih', 40))
      .toMatch(/^kacamata_kotak_hitam_dan_putih/);
  });

  it('truncates to limit', () => {
    expect(slugifyContent('a'.repeat(100), 10).length).toBeLessThanOrEqual(10);
  });
});
