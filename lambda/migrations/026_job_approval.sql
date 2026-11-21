-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs. Run 025_profile_signoff.sql first.
--
-- v2.0.0 Part C (Job Details and Approval):
--   * Every job now ends with the R&M Manager's signed approval. JOB.job_status
--     runs approved -> accepted -> arrived -> pending_approval -> closed (the
--     report itself is the "submitted" step). A send-back returns a job from
--     pending_approval to arrived.
--   * JOB_FOLLOWUP     follow-ups a technician adds to a job. Each one must
--                      become a job order when the job is approved.
--   * JOB_EVENT        the Job Progress log shown on every job screen and in the
--                      PDF: who, when, what, and the selfie for signed steps.
--   * JOB_REF_SEQ      the running number for SKSC-JCR-YYYY-MM-DD-NN, taken
--                      when the report is submitted (job orders: when issued).
--   * JOB_MEDIA        what a photo is (task / after / follow-up) and which of
--                      the 5 after-photo slots it fills.
--   * REPORT_MEDIA     what a report photo is (issue / cluster / exterior).
--   * Late arrival     settings for the 90 min / every 30 min delay update.
--   * Fleet Manager remarks on closed jobs.
--
-- JOB_EVENT and JOB_FOLLOWUP index job_id/report_id but don't declare foreign
-- keys to JOB/REPORT. Those tables predate the migrations and their id types
-- were never pinned down; a mismatched FK would fail the whole migration.
--
-- Steps 1, 4, 6, 7 and 9 are plain ALTERs: safe to run once.

-- 1. JOB columns -------------------------------------------------------------
ALTER TABLE JOB
  ADD COLUMN job_source VARCHAR(16) NOT NULL DEFAULT 'REPORT',
  ADD COLUMN parent_job_id BIGINT UNSIGNED NULL,
  ADD COLUMN followup_id BIGINT UNSIGNED NULL,
  ADD COLUMN job_priority VARCHAR(16) NULL,
  ADD COLUMN job_required_action VARCHAR(300) NULL,
  ADD COLUMN job_remarks VARCHAR(300) NULL,
  ADD COLUMN job_issued_at DATETIME NULL,
  ADD COLUMN job_approved_by BIGINT UNSIGNED NULL,
  ADD COLUMN job_approved_at DATETIME NULL,
  ADD COLUMN job_approved_verified_name VARCHAR(150) NULL,
  ADD COLUMN job_approved_selfie_s3_bucket VARCHAR(255) NULL,
  ADD COLUMN job_approved_selfie_s3_key VARCHAR(255) NULL,
  ADD COLUMN job_late_flag TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN job_late_prompted_at DATETIME NULL,
  ADD COLUMN job_last_delay_at DATETIME NULL,
  ADD COLUMN fm_remarks VARCHAR(500) NULL,
  ADD COLUMN fm_remarks_by BIGINT UNSIGNED NULL,
  ADD COLUMN fm_remarks_at DATETIME NULL,
  ADD COLUMN fm_remarks_edited_at DATETIME NULL,
  ADD INDEX idx_job_parent (parent_job_id),
  ADD INDEX idx_job_status (job_status);

-- 2. job_status must hold the new values. If it is an ENUM, make it a VARCHAR.
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

-- 3. Where each existing job is: job orders logged by a technician vs jobs
--    from a report, and today's 'open' split by how far the job has got.
UPDATE JOB j JOIN REPORT r ON r.job_id = j.job_id
SET j.job_source = 'TECH_ORDER', j.job_issued_at = COALESCE(j.job_issued_at, j.job_created_at)
WHERE r.report_type = 'job_order';

UPDATE JOB SET job_status = 'closed' WHERE job_status IN ('completed', 'done');
UPDATE JOB SET job_status = 'approved' WHERE job_status = 'open' AND technician_user_id IS NULL;
UPDATE JOB SET job_status = 'accepted' WHERE job_status = 'open' AND job_odometer IS NULL;
UPDATE JOB SET job_status = 'arrived' WHERE job_status = 'open';

-- 4. Reference numbers ------------------------------------------------------
ALTER TABLE REPORT
  ADD COLUMN report_ref_no VARCHAR(32) NULL,
  ADD UNIQUE KEY uq_report_ref_no (report_ref_no);

CREATE TABLE IF NOT EXISTS JOB_REF_SEQ (
  ref_date DATE NOT NULL PRIMARY KEY,
  last_no  INT UNSIGNED NOT NULL DEFAULT 0
);

-- Jobs already numbered keep their number, on the report as well.
UPDATE REPORT r JOIN JOB j ON j.job_id = r.job_id
SET r.report_ref_no = j.job_ref_no
WHERE j.job_ref_no IS NOT NULL AND r.report_ref_no IS NULL;

-- Continue each day's numbering after the highest number already handed out.
INSERT INTO JOB_REF_SEQ (ref_date, last_no)
SELECT STR_TO_DATE(SUBSTRING(job_ref_no, 10, 10), '%Y-%m-%d'),
       MAX(CAST(SUBSTRING_INDEX(job_ref_no, '-', -1) AS UNSIGNED))
FROM JOB
WHERE job_ref_no LIKE 'SKSC-JCR-____-__-__-%'
GROUP BY SUBSTRING(job_ref_no, 10, 10)
ON DUPLICATE KEY UPDATE last_no = GREATEST(last_no, VALUES(last_no));

-- 5. Job Progress events ----------------------------------------------------
CREATE TABLE IF NOT EXISTS JOB_EVENT (
  event_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  report_id         BIGINT UNSIGNED NULL,
  job_id            BIGINT UNSIGNED NULL,
  event_type        VARCHAR(40) NOT NULL,
  actor_user_id     BIGINT UNSIGNED NULL,
  actor_name_signed VARCHAR(150) NULL,
  actor_username    VARCHAR(128) NULL,
  actor_role        VARCHAR(32) NULL,
  selfie_s3_bucket  VARCHAR(255) NULL,
  selfie_s3_key     VARCHAR(255) NULL,
  event_at          DATETIME NOT NULL,
  detail            JSON NULL,
  KEY idx_job_event_job (job_id, event_at),
  KEY idx_job_event_report (report_id, event_at),
  CONSTRAINT fk_job_event_user FOREIGN KEY (actor_user_id) REFERENCES `USER`(user_id) ON DELETE SET NULL
);

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

-- 6. Follow-ups -------------------------------------------------------------
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

-- 7. What each photo is -----------------------------------------------------
ALTER TABLE JOB_MEDIA
  ADD COLUMN media_kind VARCHAR(16) NULL,
  ADD COLUMN media_slot VARCHAR(16) NULL,
  ADD COLUMN followup_id BIGINT UNSIGNED NULL,
  ADD INDEX idx_job_media_kind (job_id, media_kind),
  ADD INDEX idx_job_media_followup (followup_id);

UPDATE JOB_MEDIA SET media_kind = IF(task_id IS NULL, 'after', 'task') WHERE media_kind IS NULL;

ALTER TABLE REPORT_MEDIA
  ADD COLUMN media_kind VARCHAR(16) NULL;

-- 8. Late-arrival settings (admin-configurable) -----------------------------
INSERT IGNORE INTO APP_SETTING (setting_key, setting_value) VALUES
('job_late_limit_min', '90'),
('job_late_repeat_min', '30');

-- 9. Category on the report is now optional (C18). report_issue_type has been
--    nullable since 021, so nothing to change.

-- Check
SELECT job_status, job_source, COUNT(*) AS jobs FROM JOB GROUP BY job_status, job_source;
SELECT event_type, COUNT(*) AS events FROM JOB_EVENT GROUP BY event_type;
SELECT COUNT(*) AS seq_days, MAX(last_no) AS highest_no FROM JOB_REF_SEQ;
SELECT media_kind, COUNT(*) AS photos FROM JOB_MEDIA GROUP BY media_kind;
