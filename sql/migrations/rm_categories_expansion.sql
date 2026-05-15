-- ============================================================
-- Categorization refinement:
-- 1. Adds 4 new top-level categories that the data demands.
-- 2. Seeds 25 starter keyword rules covering the most common
--    'Other' patterns observed in production data.
-- 3. Retroactively applies all active rules so matching
--    descriptions flip from 'ai' to 'rule' immediately.
-- ============================================================

BEGIN;

-- 1. New categories
INSERT INTO rm_categories (slug, display_name, sort_order) VALUES
  ('vehicles',           'Vehicles',                   13),
  ('labour_wages',       'Labour & Wages',             14),
  ('cleaning_services',  'Cleaning Services',          15),
  ('capex_amortization', 'Capex / Amortization',       16)
ON CONFLICT (slug) DO NOTHING;

-- 2. Starter rule pack — 25 patterns
INSERT INTO rm_keyword_rules (pattern, category_id)
SELECT seed.pattern,
       (SELECT id FROM rm_categories WHERE slug = seed.target_slug)
  FROM (VALUES
    -- fire_safety
    ('fire extinguisher',  'fire_safety'),
    ('fire equipment',     'fire_safety'),
    ('spill kit',          'fire_safety'),
    ('co2 container',      'fire_safety'),
    ('fire point',         'fire_safety'),
    -- pumps_dispensers
    ('zva',                'pumps_dispensers'),
    ('nozzle',             'pumps_dispensers'),
    ('hose',               'pumps_dispensers'),
    ('breakaway',          'pumps_dispensers'),
    ('swivel',             'pumps_dispensers'),
    -- compressors_air
    ('pressure gauge',     'compressors_air'),
    -- tanks_lines
    ('dipstick',           'tanks_lines'),
    ('manhole',            'tanks_lines'),
    -- plumbing_water_waste
    ('borehole',           'plumbing_water_waste'),
    ('liquid waste',       'plumbing_water_waste'),
    -- cleaning_services (new)
    ('canopy cleaning',    'cleaning_services'),
    ('deep cleaning',      'cleaning_services'),
    ('forecourt cleaning', 'cleaning_services'),
    -- vehicles (new)
    ('plymouth',           'vehicles'),
    ('tyre',               'vehicles'),
    -- labour_wages (new)
    ('wages',              'labour_wages'),
    ('caretaker',          'labour_wages'),
    ('gardener',           'labour_wages'),
    -- capex_amortization (new)
    ('amortization',       'capex_amortization'),
    ('amortisation',       'capex_amortization')
  ) AS seed(pattern, target_slug)
ON CONFLICT DO NOTHING;

-- 3. Retroactive apply — same logic as APPLY_RULES_SQL in lib/rm-rules.ts.
-- Longest pattern wins per description_norm. Never touches source='override'.
WITH best_match AS (
  SELECT
    rdc.description_norm,
    r.category_id,
    ROW_NUMBER() OVER (
      PARTITION BY rdc.description_norm
      ORDER BY LENGTH(r.pattern) DESC, r.id
    ) AS rk
  FROM rm_description_categories rdc
  JOIN rm_keyword_rules r
    ON r.is_active = TRUE
   AND rdc.description_norm LIKE '%' || lower(r.pattern) || '%'
  WHERE rdc.source != 'override'
)
UPDATE rm_description_categories rdc
SET category_id  = bm.category_id,
    source       = 'rule',
    confidence   = 'high',
    needs_review = FALSE,
    updated_at   = NOW()
FROM best_match bm
WHERE rdc.description_norm = bm.description_norm
  AND bm.rk = 1
  AND (rdc.category_id IS DISTINCT FROM bm.category_id OR rdc.source != 'rule');

COMMIT;
