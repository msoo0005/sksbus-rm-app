-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — push notification registration assumes this table exists.

CREATE TABLE IF NOT EXISTS PUSH_TOKEN (
  push_token_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id        BIGINT UNSIGNED NOT NULL,
  expo_push_token VARCHAR(255) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_token_token (expo_push_token),
  CONSTRAINT fk_push_token_user
    FOREIGN KEY (user_id) REFERENCES `USER`(user_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_push_token_user ON PUSH_TOKEN (user_id);
