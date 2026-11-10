-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — the scheduled tyre digest assumes this table exists.
--
-- Recurring alerts need to know what they already said. NOTIFICATION has no
-- bus_id or tyre_id column, so "have I already told them about these buses?"
-- cannot be derived from it — hence a small table of its own, keyed by a hash
-- of the alerting set.
--
-- The rule the digest applies: an unchanged set stays quiet for 7 days rather
-- than nagging daily, while any change to the set produces a new key and
-- alerts immediately. A bus that is inspected and later goes overdue again
-- re-alerts naturally, because it re-enters the set.
--
-- Deliberately generic — reusable by any future recurring alert, not just tyres.

CREATE TABLE IF NOT EXISTS NOTIFICATION_DEDUPE (
  dedupe_key   VARCHAR(191) PRIMARY KEY,
  last_sent_at DATETIME NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- VARCHAR(191) not 255: under utf8mb4 a 255-char key is 1020 bytes, over the
-- 767-byte index limit on older InnoDB row formats. 191 is the safe maximum.

CREATE INDEX idx_notification_dedupe_sent ON NOTIFICATION_DEDUPE (last_sent_at);
