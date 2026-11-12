-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs.
--
-- Adds what the new screens need:
--   1. REPORT.report_issue_type: the issue type picked on the report form,
--      used to group jobs in Performance & KPIs. NULL is read as "other".
--   2. JOB.job_arrived_at: when the technician recorded the arrival odometer.
--      This splits turnaround into travel and on-site repair.
--   3. Job Completion Report PDF: the fixed reference number, plus where the
--      generated PDF is stored.
--   4. Tasks: a separate follow-up/remark field, and a "no parts used" flag.
--   5. Parts: a unit (pc, L, kg ...). Quantities can be fractional ("1.5 L").
--   6. REPORT.report_type must accept 'job_order' (a job a technician logs
--      directly, with no breakdown report).
--   7. Indexes for the KPI queries.
--
-- Every step is safe to run once. Steps 5b and 6 inspect the column's real
-- definition first, since the original table types were never pinned down in
-- a migration. This uses the same approach as 012_report_draft_status.sql.

-- 1
ALTER TABLE REPORT
  ADD COLUMN report_issue_type VARCHAR(40) NULL AFTER report_type;

-- 2 + 3
ALTER TABLE JOB
  ADD COLUMN job_arrived_at DATETIME NULL AFTER job_accepted_at,
  ADD COLUMN job_ref_no VARCHAR(32) NULL,
  ADD COLUMN job_report_pdf_s3_key VARCHAR(512) NULL,
  ADD COLUMN job_report_issued_at DATETIME NULL,
  ADD UNIQUE KEY uq_job_ref_no (job_ref_no);

-- 4
ALTER TABLE JOB_TASK
  ADD COLUMN task_remark TEXT NULL AFTER task_desc,
  ADD COLUMN task_no_parts TINYINT(1) NOT NULL DEFAULT 0 AFTER task_remark;

-- 5a
ALTER TABLE PART
  ADD COLUMN part_unit VARCHAR(16) NOT NULL DEFAULT 'pc' AFTER part_brand;

-- 5b: JOB_TASK_PART.qty -> DECIMAL(10,2), keeping its nullability.
SET @qty_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_TASK_PART' AND COLUMN_NAME = 'qty'
);
SET @qty_null := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_TASK_PART' AND COLUMN_NAME = 'qty'
);
SET @sql := IF(
  @qty_type <> 'decimal',
  CONCAT('ALTER TABLE JOB_TASK_PART MODIFY COLUMN qty DECIMAL(10,2)',
         IF(@qty_null = 'YES', ' NULL', ' NOT NULL DEFAULT 1')),
  'SELECT ''JOB_TASK_PART.qty is already DECIMAL'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6: allow report_type = 'job_order' if the column is an ENUM.
SET @col_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_type'
);
SET @is_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_type'
);
SET @charset := (
  SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_type'
);
SET @collation := (
  SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_type'
);
SET @col_default := (
  SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_type'
);
SET @sql := IF(
  @col_type LIKE 'enum(%' AND @col_type NOT LIKE "%'job_order'%",
  CONCAT(
    'ALTER TABLE REPORT MODIFY COLUMN report_type ',
    CONCAT('enum(''job_order'',', SUBSTRING(@col_type, 6)),
    IF(@charset IS NULL, '', CONCAT(' CHARACTER SET ', @charset)),
    IF(@collation IS NULL, '', CONCAT(' COLLATE ', @collation)),
    IF(@is_nullable = 'YES', ' NULL', ' NOT NULL'),
    IF(@col_default IS NULL, '', CONCAT(' DEFAULT ''', @col_default, ''''))
  ),
  'SELECT ''report_type already accepts job_order'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7
CREATE INDEX idx_report_project_uploaded ON REPORT (project_id, report_uploaded_at);
CREATE INDEX idx_report_bus_uploaded ON REPORT (bus_id, report_uploaded_at);

-- Check
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'REPORT' AND COLUMN_NAME IN ('report_type', 'report_issue_type'))
    OR (TABLE_NAME = 'JOB' AND COLUMN_NAME IN ('job_arrived_at', 'job_ref_no', 'job_report_pdf_s3_key'))
    OR (TABLE_NAME = 'JOB_TASK' AND COLUMN_NAME IN ('task_remark', 'task_no_parts'))
    OR (TABLE_NAME = 'JOB_TASK_PART' AND COLUMN_NAME = 'qty')
    OR (TABLE_NAME = 'PART' AND COLUMN_NAME = 'part_unit'));
