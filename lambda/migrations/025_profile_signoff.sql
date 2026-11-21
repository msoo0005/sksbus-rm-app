-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs (the /me profile endpoints assume these columns exist).
--
-- v2.0.0 designs, parts A and S:
--   USER.user_username     the Cognito username ("@jamiesoo"), shown beside
--                          every name. Written by the API from the token on
--                          each request; never typed by anyone.
--   USER.user_full_name    the name from My profile (A6). Fills the home
--                          greeting and every sign-off card. Editable by the
--                          user; the API no longer overwrites it from the
--                          token once set.
--   USER.user_avatar_*     the My profile photo. No photo = the initial.
--   USER_PREFERENCE        small per-user settings kept on the server so they
--                          survive a reinstall (the jobs list Sort by choice).
--
-- Steps 1 and 3 are plain ALTERs: safe to run once.

-- 1. Profile columns ---------------------------------------------------------
ALTER TABLE `USER`
  ADD COLUMN user_username VARCHAR(128) NULL AFTER user_name,
  ADD COLUMN user_full_name VARCHAR(150) NULL AFTER user_username,
  ADD COLUMN user_avatar_s3_bucket VARCHAR(255) NULL AFTER user_full_name,
  ADD COLUMN user_avatar_s3_key VARCHAR(255) NULL AFTER user_avatar_s3_bucket;

-- Everyone starts with the name the app already shows for them.
UPDATE `USER` SET user_full_name = user_name
WHERE user_full_name IS NULL AND user_name IS NOT NULL AND user_name <> '' AND user_name <> 'Unknown';

-- 2. Per-user preferences ----------------------------------------------------
CREATE TABLE IF NOT EXISTS USER_PREFERENCE (
  user_id     BIGINT UNSIGNED NOT NULL,
  pref_key    VARCHAR(64) NOT NULL,
  pref_value  JSON NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, pref_key),
  CONSTRAINT fk_user_preference_user FOREIGN KEY (user_id) REFERENCES `USER`(user_id) ON DELETE CASCADE
);

-- 3. Declining a report is now a signed step ("Who is declining?") ----------
-- It reuses report_review_verified_name / report_review_selfie_* (020), which
-- hold whichever review action was taken. Nothing to add.

-- Check
SELECT COLUMN_NAME FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'USER' AND COLUMN_NAME LIKE 'user\_%'
ORDER BY ORDINAL_POSITION;
SELECT COUNT(*) AS users, SUM(user_full_name IS NOT NULL) AS with_full_name FROM `USER`;
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'USER_PREFERENCE';
