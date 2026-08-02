-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — lets after-photos be attached to a specific task
-- instead of only to the job as a whole.

ALTER TABLE JOB_MEDIA
  ADD COLUMN task_id BIGINT UNSIGNED NULL AFTER job_id;

ALTER TABLE JOB_MEDIA
  ADD CONSTRAINT fk_job_media_task
    FOREIGN KEY (task_id) REFERENCES JOB_TASK(task_id)
    ON DELETE SET NULL;

CREATE INDEX idx_job_media_task ON JOB_MEDIA (task_id);
