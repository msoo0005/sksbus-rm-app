    -- ============================================================
-- Clear all reports and jobs for a fresh start.
--
-- WIPED (all rows):  REPORT, REPORT_MEDIA, JOB, JOB_TASK,
--                    JOB_TASK_PART, JOB_MEDIA, JOB_HISTORY,
--                    NOTIFICATION
-- KEPT (untouched):  USER, USER_PROJECT, PROJECT, BUS, PART,
--                    PUSH_TOKEN, APP_SETTING, NOTIFICATION_DEDUPE,
--                    and every TYRE* table (tyres, mountings, swaps,
--                    inspections and tread readings)
--
-- Jobs are wiped with reports because every job is created from a
-- report. Notifications are wiped because their rows point at the
-- reports and jobs being deleted, so they would link to nothing.
-- Part stock is not affected: parts used on jobs never decremented
-- PART.part_stock.
--
-- NOT REVERSIBLE. Take an RDS snapshot first.
--
-- Foreign key checks stay ON on purpose. Tables are deleted children
-- first, so a normal database needs no override. If some table not
-- listed here also points at a report or job, the DELETE fails and the
-- whole transaction rolls back, instead of silently leaving broken rows.
--
-- Photos and selfies in S3 under reports/ and jobs/ are NOT deleted by
-- this script. They are unreachable once their rows are gone.
--
--   mysql -h <DB_HOST> -u <DB_USER> -p <DB_NAME> < clear_reports_and_jobs.sql
-- ============================================================

-- ── Before: what is about to be deleted ─────────────────────────
SELECT 'REPORT' AS tbl, COUNT(*) AS rows_before FROM REPORT
UNION ALL SELECT 'REPORT_MEDIA',  COUNT(*) FROM REPORT_MEDIA
UNION ALL SELECT 'JOB',           COUNT(*) FROM JOB
UNION ALL SELECT 'JOB_TASK',      COUNT(*) FROM JOB_TASK
UNION ALL SELECT 'JOB_TASK_PART', COUNT(*) FROM JOB_TASK_PART
UNION ALL SELECT 'JOB_MEDIA',     COUNT(*) FROM JOB_MEDIA
UNION ALL SELECT 'JOB_HISTORY',   COUNT(*) FROM JOB_HISTORY
UNION ALL SELECT 'NOTIFICATION',  COUNT(*) FROM NOTIFICATION;

START TRANSACTION;

-- Children first, then their parents.
DELETE FROM NOTIFICATION;
DELETE FROM JOB_TASK_PART;
DELETE FROM JOB_MEDIA;
DELETE FROM JOB_HISTORY;
DELETE FROM JOB_TASK;
DELETE FROM REPORT_MEDIA;
DELETE FROM REPORT;
DELETE FROM JOB;

COMMIT;

-- ── Restart numbering at 1 ──────────────────────────────────────
-- Run after COMMIT: ALTER TABLE ends any open transaction.
ALTER TABLE NOTIFICATION  AUTO_INCREMENT = 1;
ALTER TABLE JOB_TASK_PART AUTO_INCREMENT = 1;
ALTER TABLE JOB_MEDIA     AUTO_INCREMENT = 1;
ALTER TABLE JOB_HISTORY   AUTO_INCREMENT = 1;
ALTER TABLE JOB_TASK      AUTO_INCREMENT = 1;
ALTER TABLE REPORT_MEDIA  AUTO_INCREMENT = 1;
ALTER TABLE REPORT        AUTO_INCREMENT = 1;
ALTER TABLE JOB           AUTO_INCREMENT = 1;

-- ── After: every count should be 0 ──────────────────────────────
SELECT 'REPORT' AS tbl, COUNT(*) AS rows_after FROM REPORT
UNION ALL SELECT 'REPORT_MEDIA',  COUNT(*) FROM REPORT_MEDIA
UNION ALL SELECT 'JOB',           COUNT(*) FROM JOB
UNION ALL SELECT 'JOB_TASK',      COUNT(*) FROM JOB_TASK
UNION ALL SELECT 'JOB_TASK_PART', COUNT(*) FROM JOB_TASK_PART
UNION ALL SELECT 'JOB_MEDIA',     COUNT(*) FROM JOB_MEDIA
UNION ALL SELECT 'JOB_HISTORY',   COUNT(*) FROM JOB_HISTORY
UNION ALL SELECT 'NOTIFICATION',  COUNT(*) FROM NOTIFICATION;
