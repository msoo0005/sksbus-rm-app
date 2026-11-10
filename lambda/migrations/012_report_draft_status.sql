-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs.
--
-- Makes report submission all-or-nothing. A report is now created as 'draft'
-- and only promoted to 'submitted' once its selfie and every photo have
-- finished uploading, so a submission that dies part-way (a failed upload, a
-- dropped connection, the OS killing the app) leaves an invisible draft
-- instead of a blank report sitting in the reviewer's pending queue — and
-- stops firing a "new report submitted" notification for a report that never
-- actually arrived.
--
-- report_status is written as a plain string by the Lambda ('submitted',
-- 'open', 'closed'), but the column's real type was never pinned down in a
-- migration — this project predates them. If it's a VARCHAR nothing needs to
-- change; if it's an ENUM, 'draft' has to be added to the allowed values or
-- every insert fails. Rather than guess, this reads the column's actual
-- definition from information_schema and only rewrites it when it is an ENUM
-- that lacks 'draft' — the same approach 006_fix_bus_fk.sql used for BUS.bus_id.

SET @col_type := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_status'
);
SET @is_nullable := (
  SELECT IS_NULLABLE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_status'
);
-- MODIFY COLUMN restates the whole definition, so anything not repeated here
-- is silently dropped — the column would quietly inherit the table's default
-- charset and lose its DEFAULT. Carry all three across unchanged.
SET @charset := (
  SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_status'
);
SET @collation := (
  SELECT COLLATION_NAME FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_status'
);
SET @col_default := (
  SELECT COLUMN_DEFAULT FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_status'
);

SELECT @col_type AS report_status_column_type_before;

-- Only rebuild the column when it is an ENUM without 'draft'. Inserts the new
-- value at the front of the existing list so no stored value changes meaning.
SET @needs_change := (@col_type LIKE 'enum(%' AND @col_type NOT LIKE "%'draft'%");
SET @sql := IF(
  @needs_change,
  CONCAT(
    'ALTER TABLE REPORT MODIFY COLUMN report_status ',
    -- 'enum(' is five characters, so the rest of the stored definition is the
    -- existing value list; 'draft' goes in front of it and nothing else moves.
    CONCAT('enum(''draft'',', SUBSTRING(@col_type, 6)),
    IF(@charset IS NULL, '', CONCAT(' CHARACTER SET ', @charset)),
    IF(@collation IS NULL, '', CONCAT(' COLLATE ', @collation)),
    IF(@is_nullable = 'YES', ' NULL', ' NOT NULL'),
    IF(@col_default IS NULL, '', CONCAT(' DEFAULT ''', @col_default, ''''))
  ),
  'SELECT ''report_status already accepts arbitrary values — no change needed'' AS note'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT COLUMN_TYPE AS report_status_column_type_after
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'REPORT' AND COLUMN_NAME = 'report_status';

-- Existing rows are untouched: anything already 'submitted' stays submitted.
-- Use lambda/scripts/cleanup_orphaned_reports.sql to clear out the blank
-- reports left behind by failed submissions before this change.
