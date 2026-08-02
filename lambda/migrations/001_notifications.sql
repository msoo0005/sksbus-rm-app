-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — the notification endpoints assume this table exists.

CREATE TABLE IF NOT EXISTS NOTIFICATION (
  notification_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            BIGINT UNSIGNED NOT NULL,
  notification_type  VARCHAR(50) NOT NULL,
  notification_title VARCHAR(255) NOT NULL,
  notification_body  TEXT NULL,
  report_id          BIGINT UNSIGNED NULL,
  job_id             BIGINT UNSIGNED NULL,
  is_read            TINYINT(1) NOT NULL DEFAULT 0,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user
    FOREIGN KEY (user_id) REFERENCES `USER`(user_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_notification_report
    FOREIGN KEY (report_id) REFERENCES REPORT(report_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_notification_job
    FOREIGN KEY (job_id) REFERENCES JOB(job_id)
    ON DELETE SET NULL
);

CREATE INDEX idx_notification_user_created ON NOTIFICATION (user_id, created_at DESC);
CREATE INDEX idx_notification_user_unread ON NOTIFICATION (user_id, is_read);
