// lib/categoryAbbrev.ts
// Short labels for category columns in the heatmap and Pareto chart.
// Categories with long names (Compressors/Air, Electrical & Lighting,
// Landscaping / Grounds, Generators / Backup Power, …) overflow their
// narrow columns even at 6.5pt with letter-spacing. Use 4–6 char
// abbreviations instead.

const ABBREV: Record<string, string> = {
  pumps:        'PUMPS',
  compressors:  'COMP',
  tanks:        'TANKS',
  generators:   'GENS',
  solar:        'SOLAR',
  electrical:   'ELEC',
  plumbing:     'PLUMB',
  building:     'BUILD',
  canopy:       'CANPY',
  landscaping:  'LAND',
  fire:         'FIRE',
  security:     'CCTV',
  other:        'OTHER',
  capex:        'CAPEX',
  labour:       'LABR',
  vehicles:     'AUTO',
  cleaning:     'CLEAN',
};

export function shortCategory(name: string): string {
  if (!name) return '';
  const first = name.split(/\s+/)[0].toLowerCase();
  return ABBREV[first] || first.slice(0, 6).toUpperCase();
}
