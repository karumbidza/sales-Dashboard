-- ============================================================
-- Drop the reports + report_comments listing tables.
-- The Past Reports UI and Report Comments thread are both removed;
-- PDFs are generated on demand and don't need server-side persistence.
-- ============================================================

DROP TABLE IF EXISTS report_comments;
DROP TABLE IF EXISTS reports;
