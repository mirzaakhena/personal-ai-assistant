// src/utils/status-bar.ts
//
// Tiny helpers to render a progress bar + percentage for the /status command.
// Mirrors the visual idiom from Claude Code's status line (U+2588 FULL BLOCK
// + U+2591 LIGHT SHADE), color-coded low/mid/high.

const BLOCK = '█'; // █
const SHADE = '░'; // ░

const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_RED = '\x1b[31m';
const RESET = '\x1b[0m';

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function makeBar(pct: number, width = 10): string {
  const safe = clampPct(pct);
  const filled = Math.floor((safe * width) / 100);
  const empty = width - filled;
  return BLOCK.repeat(filled) + SHADE.repeat(empty);
}

/** ANSI color escape pair for the given percentage (green <50, yellow <75, red ≥75). */
export function pctColor(pct: number): { open: string; close: string } {
  if (pct < 50) return { open: FG_GREEN, close: RESET };
  if (pct < 75) return { open: FG_YELLOW, close: RESET };
  return { open: FG_RED, close: RESET };
}

/**
 * Render "█████░░░░░ 47%" (or colored / plain variants).
 * Set `color: false` for surfaces that don't support ANSI (telegram, logs).
 */
export function renderBarLine(
  pct: number,
  options: { color?: boolean; width?: number } = {}
): string {
  const width = options.width ?? 10;
  const safe = clampPct(pct);
  const bar = makeBar(safe, width);
  if (options.color) {
    const { open, close } = pctColor(safe);
    return `${open}${bar}${close} ${open}${safe}%${close}`;
  }
  return `${bar} ${safe}%`;
}

/** Compute context-window utilization pct from usage tokens and the model's limit. */
export function contextPercentage(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return (used / limit) * 100;
}
