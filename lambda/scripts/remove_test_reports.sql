USE sksbus;

SET @report_ids = '3,4';
SET @job_ids = (SELECT GROUP_CONCAT(job_id) FROM REPORT
                WHERE FIND_IN_SET(report_id, @report_ids) AND job_id IS NOT NULL);

-- Check first: these should be the two you mean
SELECT report_id, job_id, report_type, bus_id, LEFT(report_desc, 60) AS description
FROM REPORT WHERE FIND_IN_SET(report_id, @report_ids);

START TRANSACTION;
DELETE FROM NOTIFICATION WHERE FIND_IN_SET(report_id, @report_ids) OR FIND_IN_SET(job_id, @job_ids);
DELETE tp FROM JOB_TASK_PART tp JOIN JOB_TASK t ON t.task_id = tp.task_id WHERE FIND_IN_SET(t.job_id, @job_ids);
DELETE FROM JOB_MEDIA    WHERE FIND_IN_SET(job_id, @job_ids);
DELETE FROM JOB_HISTORY  WHERE FIND_IN_SET(job_id, @job_ids);
DELETE FROM JOB_TASK     WHERE FIND_IN_SET(job_id, @job_ids);
DELETE FROM REPORT_MEDIA WHERE FIND_IN_SET(report_id, @report_ids);
DELETE FROM REPORT       WHERE FIND_IN_SET(report_id, @report_ids);
DELETE FROM JOB          WHERE FIND_IN_SET(job_id, @job_ids);
COMMIT;

-- Both should be 0
SELECT COUNT(*) AS reports_left FROM REPORT WHERE FIND_IN_SET(report_id, @report_ids);
SELECT COUNT(*) AS jobs_left    FROM JOB    WHERE FIND_IN_SET(job_id, @job_ids);
