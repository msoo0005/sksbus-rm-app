-- Run this against your RDS/MySQL database AFTER 021_kpis_job_orders.sql and
-- BEFORE deploying the updated lambda/index.mjs.
--
-- Every task now records:
--   - its job type: 'repair' (fix a fault) or 'maintenance' (scheduled service)
--   - its category: one of the 29 EV bus system categories ("EV Bus – System
--     Category & Description Master List"), stored as a stable key such as
--     'low_voltage_electrical'. See BUS_SYSTEMS in lambda/index.mjs.
--
-- The 29 categories also replace the 7 simple issue types on reports, in the
-- same column, REPORT.report_issue_type. Old values are converted where the
-- meaning is clear; 'battery_electrical' (HV or LV?) and 'other' become NULL,
-- shown as "uncategorised".

ALTER TABLE JOB_TASK
  ADD COLUMN task_job_type VARCHAR(16) NULL AFTER task_no_parts,
  ADD COLUMN task_category VARCHAR(40) NULL AFTER task_job_type;

UPDATE REPORT SET report_issue_type = CASE report_issue_type
    WHEN 'brakes'       THEN 'axle_braking'
    WHEN 'doors'        THEN 'doors_access'
    WHEN 'aircon'       THEN 'hvac'
    WHEN 'tyres_wheels' THEN 'wheels_tyres'
    WHEN 'body_glass'   THEN 'body_structure'
    ELSE NULL
  END
WHERE report_issue_type IN ('brakes', 'doors', 'aircon', 'tyres_wheels', 'body_glass', 'battery_electrical', 'other');

-- Check
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'JOB_TASK' AND COLUMN_NAME IN ('task_job_type', 'task_category');
SELECT report_issue_type, COUNT(*) AS reports FROM REPORT GROUP BY report_issue_type;
