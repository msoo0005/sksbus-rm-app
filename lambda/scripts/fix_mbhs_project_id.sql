-- ============================================================
-- One-off fix: correct the Hulu Selangor project's project_id.
--
-- reset_and_seed_real_data.sql originally inserted this row with
-- project_id = 'HULUSELANGOR' (12 characters) while every other
-- project code is short (3-8 chars). If the PROJECT.project_id
-- column has a length limit under 12, MySQL would have truncated
-- (or rejected) that value on insert, so the stored id no longer
-- matches the app's logo lookup key ('MBHS').
--
-- Captures whatever the actual stored value was via @old_id rather
-- than guessing the truncated string, and disables FK checks around
-- both updates so this works regardless of insert/update ordering
-- even if USER_PROJECT has a row referencing the old id.
--
--   mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < fix_mbhs_project_id.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

SET @old_id := (
  SELECT project_id FROM PROJECT
  WHERE project_name = 'Majlis Bandaraya Hulu Selangor (Smart Selangor)'
  LIMIT 1
);

UPDATE PROJECT
SET project_id = 'MBHS'
WHERE project_name = 'Majlis Bandaraya Hulu Selangor (Smart Selangor)';

-- Carries over any existing assignment under the old id. Safe no-op if
-- there wasn't one (@old_id was NULL, or nothing referenced it).
UPDATE USER_PROJECT
SET project_id = 'MBHS'
WHERE project_id = @old_id;

SET FOREIGN_KEY_CHECKS = 1;
