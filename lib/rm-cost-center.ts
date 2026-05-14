// lib/rm-cost-center.ts
// Maps the eight Dynamics cost-center *Code columns to a single cost_center value.
// Priority order: first non-empty wins.

export type CostCenter =
  | 'retail'
  | 'commercial'
  | 'head_office'
  | 'supply_chain'
  | 'projects'
  | 'lubricants'
  | 'hsse'
  | 'non_redan_sites'
  | 'other';

const PRIORITY: { col: string; cc: CostCenter }[] = [
  { col: 'Retail Code',           cc: 'retail' },
  { col: 'Commercial Code',       cc: 'commercial' },
  { col: 'Head office Code',      cc: 'head_office' },
  { col: 'Supply Chain Code',     cc: 'supply_chain' },
  { col: 'Projects Code',         cc: 'projects' },
  { col: 'Lubricants Code',       cc: 'lubricants' },
  { col: 'Hsse Code',             cc: 'hsse' },
  { col: 'Non redan sites Code',  cc: 'non_redan_sites' },
];

function isFilled(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function deriveCostCenter(row: Record<string, unknown>): CostCenter {
  for (const { col, cc } of PRIORITY) {
    if (isFilled(row[col])) return cc;
  }
  return 'other';
}
