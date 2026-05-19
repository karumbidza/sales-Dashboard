// lib/format-delta.ts
// Pure helper for formatting KPI delta indicators (arrows + magnitude
// + good/bad class). Used by all print components.

export type ArrowDirection = 'up' | 'down' | 'flat';
export type GoodDirection  = 'up' | 'down';

export interface FormattedDelta {
  direction: ArrowDirection;
  magnitude: string;          // "4.3" or "—"
  cls:       'kpi-good' | 'kpi-bad' | 'kpi-dim';
}

interface Options {
  /** Absolute threshold under which we treat as flat (default 0, i.e. only exact 0 is flat). */
  flatThreshold?: number;
  /** Decimal places in the magnitude (default 1). */
  decimals?: number;
}

export function formatDelta(
  value: number | null,
  goodDirection: GoodDirection,
  options: Options = {},
): FormattedDelta {
  const { flatThreshold = 0, decimals = 1 } = options;

  if (value === null || value === undefined || Number.isNaN(value)) {
    return { direction: 'flat', magnitude: '—', cls: 'kpi-dim' };
  }

  const magnitude = Math.abs(value).toFixed(decimals);

  if (Math.abs(value) <= flatThreshold) {
    return { direction: 'flat', magnitude, cls: 'kpi-dim' };
  }

  const isUp = value > 0;
  const direction: ArrowDirection = isUp ? 'up' : 'down';
  const isGood = (isUp && goodDirection === 'up') || (!isUp && goodDirection === 'down');
  return {
    direction,
    magnitude,
    cls: isGood ? 'kpi-good' : 'kpi-bad',
  };
}
