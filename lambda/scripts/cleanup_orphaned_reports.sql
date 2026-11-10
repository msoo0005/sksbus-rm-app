-- ============================================================
-- Clear out blank reports left behind by failed submissions.
--
-- Before 012_report_draft_status.sql, form.tsx created the REPORT row first
-- and only then uploaded the selfie and photos. Any submission that failed
-- part-way — and every one did while the selfie routes were missing from API
-- Gateway — left a row at status 'submitted' with no selfie and no photos,
-- sitting in the reviewer's pending queue. This removes those.
--
-- "Orphaned" is deliberately strict: no photos AND no selfie AND still
-- pending AND never reviewed AND no job attached. A report with even one
-- photo was a real submission that partly succeeded and is left alone for a
-- human to judge.
--
--   mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < cleanup_orphaned_reports.sql
--
-- ⚠️ Run the SELECT first and read the list. The DELETE at the bottom is
--    commented out on purpose — uncomment it only once the list looks right.
-- ============================================================

CREATE TEMPORARY TABLE _orphan_reports AS
SELECT r.report_id
FROM REPORT r
LEFT JOIN REPORT_MEDIA m ON m.report_id = r.report_id
WHERE m.media_id IS NULL
  AND r.report_selfie_s3_key IS NULL
  AND r.job_id IS NULL
  AND r.report_review_action IS NULL
  AND (
    r.report_status IS NULL
    OR TRIM(r.report_status) = ''
    OR LOWER(TRIM(r.report_status)) IN ('submitted', 'pending', 'draft')
  );

-- 1. Review what would go. Check the count and dates look like failed
--    attempts (typically clustered around your testing) and not real reports.
SELECT
  r.report_id,
  r.report_uploaded_at,
  r.report_type,
  r.bus_id,
  r.project_id,
  r.report_status,
  u.user_name AS reporter
FROM REPORT r
JOIN _orphan_reports o ON o.report_id = r.report_id
LEFT JOIN `USER` u ON u.user_id = r.user_id
ORDER BY r.report_uploaded_at DESC;

SELECT COUNT(*) AS orphaned_reports_found FROM _orphan_reports;

-- 2. Uncomment to delete. NOTIFICATION rows go first — they carry a report_id
--    foreign key, so the REPORT delete fails while they still reference it.
--
-- DELETE n FROM NOTIFICATION n JOIN _orphan_reports o ON o.report_id = n.report_id;
-- DELETE r FROM REPORT r JOIN _orphan_reports o ON o.report_id = r.report_id;
-- SELECT ROW_COUNT() AS reports_deleted;

DROP TEMPORARY TABLE _orphan_reports;
