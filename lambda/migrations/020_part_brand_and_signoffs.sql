-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs.
--
-- 1. PART.part_brand — the brand of a part in the parts catalogue (added from
--    the Parts Admin screen). part_stock is left as it is: stock tracking is
--    not wired into the app yet.
--
-- 2. Identity sign-offs for the two remaining stages. Report submission and
--    job completion already capture a typed name + selfie (008); approving a
--    report (R&M) and accepting a job (technician) now do too.

ALTER TABLE PART
  ADD COLUMN part_brand VARCHAR(100) NULL AFTER part_code;

ALTER TABLE REPORT
  ADD COLUMN report_review_verified_name VARCHAR(150) NULL AFTER report_review_at,
  ADD COLUMN report_review_selfie_s3_bucket VARCHAR(255) NULL AFTER report_review_verified_name,
  ADD COLUMN report_review_selfie_s3_key VARCHAR(255) NULL AFTER report_review_selfie_s3_bucket;

ALTER TABLE JOB
  ADD COLUMN job_accept_verified_name VARCHAR(150) NULL AFTER job_accepted_at,
  ADD COLUMN job_accept_selfie_s3_bucket VARCHAR(255) NULL AFTER job_accept_verified_name,
  ADD COLUMN job_accept_selfie_s3_key VARCHAR(255) NULL AFTER job_accept_selfie_s3_bucket;

-- 3. Accounts with no email were stored with user_email = '' (now NULL).
--    USER.user_email is UNIQUE, so only one such account could ever exist —
--    the next one failed to be created and got "Internal Server Error" on
--    every request. Convert the existing one so it can't block anyone.
UPDATE `USER` SET user_email = NULL WHERE user_email = '';
