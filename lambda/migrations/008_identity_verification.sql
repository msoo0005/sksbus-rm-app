-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs.
--
-- Adds "who actually submitted / completed this" verification data: a name
-- typed fresh at the moment of the action, plus a required front-camera
-- selfie — captured separately from the logged-in account's name, since the
-- account holder isn't necessarily the person physically submitting the
-- report or standing there completing the job.

ALTER TABLE REPORT
  ADD COLUMN report_verified_name VARCHAR(150) NULL AFTER report_uploaded_at,
  ADD COLUMN report_selfie_s3_bucket VARCHAR(255) NULL AFTER report_verified_name,
  ADD COLUMN report_selfie_s3_key VARCHAR(255) NULL AFTER report_selfie_s3_bucket;

ALTER TABLE JOB
  ADD COLUMN job_verified_name VARCHAR(150) NULL AFTER job_completed_at,
  ADD COLUMN job_selfie_s3_bucket VARCHAR(255) NULL AFTER job_verified_name,
  ADD COLUMN job_selfie_s3_key VARCHAR(255) NULL AFTER job_selfie_s3_bucket;
