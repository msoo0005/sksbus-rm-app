-- Repair for a 026_job_approval.sql run that stopped part-way.
--
-- Safe to run any number of times: every column and index is added only if it
-- is missing, and every data step either checks before writing or only fills
-- what is still empty. Run it from top to bottom, then check the output of the
-- "-- Check" block at the end.

-- 1. Missing columns ---------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_source') = 0,
  'ALTER TABLE JOB ADD COLUMN job_source VARCHAR(16) NOT NULL DEFAULT ''REPORT''', 'SELECT ''JOB.job_source already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'parent_job_id') = 0,
  'ALTER TABLE JOB ADD COLUMN parent_job_id BIGINT UNSIGNED NULL', 'SELECT ''JOB.parent_job_id already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'followup_id') = 0,
  'ALTER TABLE JOB ADD COLUMN followup_id BIGINT UNSIGNED NULL', 'SELECT ''JOB.followup_id already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_priority') = 0,
  'ALTER TABLE JOB ADD COLUMN job_priority VARCHAR(16) NULL', 'SELECT ''JOB.job_priority already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_required_action') = 0,
  'ALTER TABLE JOB ADD COLUMN job_required_action VARCHAR(300) NULL', 'SELECT ''JOB.job_required_action already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_remarks') = 0,
  'ALTER TABLE JOB ADD COLUMN job_remarks VARCHAR(300) NULL', 'SELECT ''JOB.job_remarks already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_issued_at') = 0,
  'ALTER TABLE JOB ADD COLUMN job_issued_at DATETIME NULL', 'SELECT ''JOB.job_issued_at already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_approved_by') = 0,
  'ALTER TABLE JOB ADD COLUMN job_approved_by BIGINT UNSIGNED NULL', 'SELECT ''JOB.job_approved_by already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_approved_at') = 0,
  'ALTER TABLE JOB ADD COLUMN job_approved_at DATETIME NULL', 'SELECT ''JOB.job_approved_at already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_approved_verified_name') = 0,
  'ALTER TABLE JOB ADD COLUMN job_approved_verified_name VARCHAR(150) NULL', 'SELECT ''JOB.job_approved_verified_name already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_approved_selfie_s3_bucket') = 0,
  'ALTER TABLE JOB ADD COLUMN job_approved_selfie_s3_bucket VARCHAR(255) NULL', 'SELECT ''JOB.job_approved_selfie_s3_bucket already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_approved_selfie_s3_key') = 0,
  'ALTER TABLE JOB ADD COLUMN job_approved_selfie_s3_key VARCHAR(255) NULL', 'SELECT ''JOB.job_approved_selfie_s3_key already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_late_flag') = 0,
  'ALTER TABLE JOB ADD COLUMN job_late_flag TINYINT(1) NOT NULL DEFAULT 0', 'SELECT ''JOB.job_late_flag already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_late_prompted_at') = 0,
  'ALTER TABLE JOB ADD COLUMN job_late_prompted_at DATETIME NULL', 'SELECT ''JOB.job_late_prompted_at already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_last_delay_at') = 0,
  'ALTER TABLE JOB ADD COLUMN job_last_delay_at DATETIME NULL', 'SELECT ''JOB.job_last_delay_at already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'fm_remarks') = 0,
  'ALTER TABLE JOB ADD COLUMN fm_remarks VARCHAR(500) NULL', 'SELECT ''JOB.fm_remarks already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'fm_remarks_by') = 0,
  'ALTER TABLE JOB ADD COLUMN fm_remarks_by BIGINT UNSIGNED NULL', 'SELECT ''JOB.fm_remarks_by already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'fm_remarks_at') = 0,
  'ALTER TABLE JOB ADD COLUMN fm_remarks_at DATETIME NULL', 'SELECT ''JOB.fm_remarks_at already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'fm_remarks_edited_at') = 0,
  'ALTER TABLE JOB ADD COLUMN fm_remarks_edited_at DATETIME NULL', 'SELECT ''JOB.fm_remarks_edited_at already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_ref_no') = 0,
  'ALTER TABLE REPORT ADD COLUMN report_ref_no VARCHAR(32) NULL', 'SELECT ''REPORT.report_ref_no already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_MEDIA' AND COLUMN_NAME = 'media_kind') = 0,
  'ALTER TABLE JOB_MEDIA ADD COLUMN media_kind VARCHAR(16) NULL', 'SELECT ''JOB_MEDIA.media_kind already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_MEDIA' AND COLUMN_NAME = 'media_slot') = 0,
  'ALTER TABLE JOB_MEDIA ADD COLUMN media_slot VARCHAR(16) NULL', 'SELECT ''JOB_MEDIA.media_slot already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_MEDIA' AND COLUMN_NAME = 'followup_id') = 0,
  'ALTER TABLE JOB_MEDIA ADD COLUMN followup_id BIGINT UNSIGNED NULL', 'SELECT ''JOB_MEDIA.followup_id already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT_MEDIA' AND COLUMN_NAME = 'media_kind') = 0,
  'ALTER TABLE REPORT_MEDIA ADD COLUMN media_kind VARCHAR(16) NULL', 'SELECT ''REPORT_MEDIA.media_kind already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Missing indexes --------------------------------------------------------
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND INDEX_NAME = 'idx_job_parent') = 0,
  'ALTER TABLE JOB ADD INDEX idx_job_parent (parent_job_id)', 'SELECT ''JOB.idx_job_parent already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND INDEX_NAME = 'idx_job_status') = 0,
  'ALTER TABLE JOB ADD INDEX idx_job_status (job_status)', 'SELECT ''JOB.idx_job_status already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND INDEX_NAME = 'uq_report_ref_no') = 0,
  'ALTER TABLE REPORT ADD UNIQUE INDEX uq_report_ref_no (report_ref_no)', 'SELECT ''REPORT.uq_report_ref_no already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_MEDIA' AND INDEX_NAME = 'idx_job_media_kind') = 0,
  'ALTER TABLE JOB_MEDIA ADD INDEX idx_job_media_kind (job_id, media_kind)', 'SELECT ''JOB_MEDIA.idx_job_media_kind already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := IF((SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_MEDIA' AND INDEX_NAME = 'idx_job_media_followup') = 0,
  'ALTER TABLE JOB_MEDIA ADD INDEX idx_job_media_followup (followup_id)', 'SELECT ''JOB_MEDIA.idx_job_media_followup already there'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. job_status must hold the new values (VARCHAR, not ENUM) ---------------
SET @js_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB' AND COLUMN_NAME = 'job_status'
);
SET @sql := IF(
  @js_type = 'enum',
  'ALTER TABLE JOB MODIFY COLUMN job_status VARCHAR(32) NOT NULL DEFAULT ''approved''',
  'SELECT ''JOB.job_status is already a string'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Data steps that needed the new columns --------------------------------
UPDATE JOB j JOIN REPORT r ON r.job_id = j.job_id
SET j.job_source = 'TECH_ORDER', j.job_issued_at = COALESCE(j.job_issued_at, j.job_created_at)
WHERE r.report_type = 'job_order' AND j.job_source <> 'TECH_ORDER';

UPDATE JOB SET job_status = 'closed' WHERE job_status IN ('completed', 'done');
UPDATE JOB SET job_status = 'approved' WHERE job_status = 'open' AND technician_user_id IS NULL;
UPDATE JOB SET job_status = 'accepted' WHERE job_status = 'open' AND job_odometer IS NULL;
UPDATE JOB SET job_status = 'arrived' WHERE job_status = 'open';

UPDATE REPORT r JOIN JOB j ON j.job_id = r.job_id
SET r.report_ref_no = j.job_ref_no
WHERE j.job_ref_no IS NOT NULL AND r.report_ref_no IS NULL;

UPDATE JOB_MEDIA SET media_kind = IF(task_id IS NULL, 'after', 'task') WHERE media_kind IS NULL;

-- 5. Tables (no-ops if they already exist) ----------------------------------
CREATE TABLE IF NOT EXISTS JOB_REF_SEQ (
  ref_date DATE NOT NULL PRIMARY KEY,
  last_no  INT UNSIGNED NOT NULL DEFAULT 0
);
INSERT INTO JOB_REF_SEQ (ref_date, last_no)
SELECT STR_TO_DATE(SUBSTRING(job_ref_no, 10, 10), '%Y-%m-%d'),
       MAX(CAST(SUBSTRING_INDEX(job_ref_no, '-', -1) AS UNSIGNED))
FROM JOB
WHERE job_ref_no LIKE 'SKSC-JCR-____-__-__-%'
GROUP BY SUBSTRING(job_ref_no, 10, 10)
ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));

CREATE TABLE IF NOT EXISTS JOB_FOLLOWUP (
  followup_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id            BIGINT UNSIGNED NOT NULL,
  issue             VARCHAR(300) NOT NULL,
  required_action   VARCHAR(300) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  job_order_job_id  BIGINT UNSIGNED NULL,
  created_by        BIGINT UNSIGNED NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at        DATETIME NULL,
  KEY idx_followup_job (job_id, status),
  CONSTRAINT fk_followup_user FOREIGN KEY (created_by) REFERENCES `USER`(user_id) ON DELETE SET NULL
);

INSERT IGNORE INTO APP_SETTING (setting_key, setting_value) VALUES
('job_late_limit_min', '90'),
('job_late_repeat_min', '30');

-- 6. Job Progress backfill (each insert skips events that already exist) ---
-- Backfill from the timestamps and sign-offs that exist today, so old jobs
-- show the same Job Progress as new ones. Each INSERT is skipped for a job
-- that already has that event, so a re-run doesn't duplicate.
INSERT INTO JOB_EVENT (report_id, job_id, event_type, actor_user_id, actor_name_signed, actor_username, actor_role,
                       selfie_s3_bucket, selfie_s3_key, event_at, detail)
SELECT r.report_id, r.job_id, 'REPORT_SUBMITTED', r.user_id, COALESCE(r.report_verified_name, u.user_name),
       u.user_username, u.user_role, r.report_selfie_s3_bucket, r.report_selfie_s3_key, r.report_uploaded_at, NULL
FROM REPORT r LEFT JOIN `USER` u ON u.user_id = r.user_id
WHERE r.report_type <> 'job_order' AND LOWER(TRIM(COALESCE(r.report_status, ''))) <> 'draft'
  AND r.report_uploaded_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM JOB_EVENT e WHERE e.report_id = r.report_id AND e.event_type = 'REPORT_SUBMITTED');

INSERT INTO JOB_EVENT (report_id, job_id, event_type, actor_name_signed, selfie_s3_bucket, selfie_s3_key, event_at, detail)
SELECT r.report_id, r.job_id,
       IF(r.report_review_action = 'approved', 'REPORT_APPROVED', 'REPORT_DECLINED'),
       COALESCE(r.report_review_verified_name, r.report_review_by),
       r.report_review_selfie_s3_bucket, r.report_review_selfie_s3_key,
       r.report_review_at,
       JSON_OBJECT('priority', r.report_priority, 'remarks', r.report_review_reason)
FROM REPORT r
WHERE r.report_type <> 'job_order' AND r.report_review_action IN ('approved', 'declined') AND r.report_review_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM JOB_EVENT e WHERE e.report_id = r.report_id AND e.event_type IN ('REPORT_APPROVED', 'REPORT_DECLINED'));

INSERT INTO JOB_EVENT (report_id, job_id, event_type, actor_user_id, actor_name_signed, actor_username, actor_role, event_at, detail)
SELECT r.report_id, j.job_id, 'JOB_ORDER_OPENED', j.technician_user_id, u.user_name, u.user_username, u.user_role,
       j.job_created_at, NULL
FROM JOB j JOIN REPORT r ON r.job_id = j.job_id LEFT JOIN `USER` u ON u.user_id = j.technician_user_id
WHERE j.job_source = 'TECH_ORDER'
  AND NOT EXISTS (SELECT 1 FROM JOB_EVENT e WHERE e.job_id = j.job_id AND e.event_type = 'JOB_ORDER_OPENED');

INSERT INTO JOB_EVENT (report_id, job_id, event_type, actor_user_id, actor_name_signed, actor_username, actor_role,
                       selfie_s3_bucket, selfie_s3_key, event_at, detail)
SELECT r.report_id, j.job_id, 'ACCEPTED', j.technician_user_id, COALESCE(j.job_accept_verified_name, u.user_name),
       u.user_username, u.user_role, j.job_accept_selfie_s3_bucket, j.job_accept_selfie_s3_key, j.job_accepted_at, NULL
FROM JOB j LEFT JOIN REPORT r ON r.job_id = j.job_id LEFT JOIN `USER` u ON u.user_id = j.technician_user_id
WHERE j.job_source = 'REPORT' AND j.job_accepted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM JOB_EVENT e WHERE e.job_id = j.job_id AND e.event_type = 'ACCEPTED');

INSERT INTO JOB_EVENT (report_id, job_id, event_type, actor_user_id, actor_name_signed, actor_username, actor_role, event_at, detail)
SELECT r.report_id, j.job_id, 'ARRIVED', j.technician_user_id, u.user_name, u.user_username, u.user_role,
       COALESCE(j.job_arrived_at, j.job_accepted_at, j.job_created_at), JSON_OBJECT('odometer_km', j.job_odometer)
FROM JOB j LEFT JOIN REPORT r ON r.job_id = j.job_id LEFT JOIN `USER` u ON u.user_id = j.technician_user_id
WHERE j.job_odometer IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM JOB_EVENT e WHERE e.job_id = j.job_id AND e.event_type = 'ARRIVED');

INSERT INTO JOB_EVENT (report_id, job_id, event_type, actor_user_id, actor_name_signed, actor_username, actor_role, event_at, detail)
SELECT r.report_id, t.job_id, 'TASK_COMPLETED', j.technician_user_id, u.user_name, u.user_username, u.user_role,
       COALESCE(t.completed_at, t.created_at), JSON_OBJECT('task_id', t.task_id, 'job_type', t.task_job_type)
FROM JOB_TASK t JOIN JOB j ON j.job_id = t.job_id
LEFT JOIN REPORT r ON r.job_id = j.job_id LEFT JOIN `USER` u ON u.user_id = j.technician_user_id
WHERE t.task_name NOT IN ('Recorded odometer reading', 'General / Parts Used')
  AND NOT EXISTS (SELECT 1 FROM JOB_EVENT e WHERE e.job_id = t.job_id AND e.event_type = 'TASK_COMPLETED'
                  AND JSON_EXTRACT(e.detail, '$.task_id') = t.task_id);

INSERT INTO JOB_EVENT (report_id, job_id, event_type, actor_user_id, actor_name_signed, actor_username, actor_role,
                       selfie_s3_bucket, selfie_s3_key, event_at, detail)
SELECT r.report_id, j.job_id, 'JOB_COMPLETED', j.technician_user_id, COALESCE(j.job_verified_name, u.user_name),
       u.user_username, u.user_role, j.job_selfie_s3_bucket, j.job_selfie_s3_key, j.job_completed_at, NULL
FROM JOB j LEFT JOIN REPORT r ON r.job_id = j.job_id LEFT JOIN `USER` u ON u.user_id = j.technician_user_id
WHERE j.job_completed_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM JOB_EVENT e WHERE e.job_id = j.job_id AND e.event_type = 'JOB_COMPLETED');

-- Check: every line should say 1 (present).
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='JOB' AND COLUMN_NAME='job_approved_at') AS job_approved_at,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='JOB' AND COLUMN_NAME='fm_remarks') AS fm_remarks,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='JOB_MEDIA' AND COLUMN_NAME='media_slot') AS media_slot,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='REPORT_MEDIA' AND COLUMN_NAME='media_kind') AS report_media_kind,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='JOB_FOLLOWUP') AS job_followup_table;
SELECT job_status, job_source, COUNT(*) AS jobs FROM JOB GROUP BY job_status, job_source;
SELECT event_type, COUNT(*) AS events FROM JOB_EVENT GROUP BY event_type;
