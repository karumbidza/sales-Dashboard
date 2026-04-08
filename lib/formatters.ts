// lib/formatters.ts — shared display helpers

/** Render a vs-budget/vs-stretch percentage as a signed *variance* (e.g. +12.4%). */
export function fmtVsBudget(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const diff = pct - 100;
  if (diff === 0) return '0.0%';
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(1)}%`;
}

/** Hex colour for a vs-budget percentage (100% = on target). */
export function vsBudgetColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '#6b7280'; // gray
  if (pct >= 100) return '#16a34a'; // green
  if (pct >= 85)  return '#d97706'; // amber
  return '#dc2626';                  // red
}

/** Tailwind background+text class for a vs-budget percentage. */
export function vsBudgetBadgeClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return 'bg-gray-100 text-gray-500';
  if (pct >= 100) return 'bg-emerald-100 text-emerald-700';
  if (pct >= 85)  return 'bg-amber-100 text-amber-700';
  return 'bg-red-100 text-red-700';
}
