-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — the rm-manager "Tyre Replacement" popup (Old Tyre Out /
-- New Tyre In) assumes this table exists.
--
-- One row per tyre swap performed through that screen: the outgoing tyre's
-- final tread readings + sidewall condition (captured right before removal),
-- plus the incoming tyre's tread readings, fitted pressure, and an install
-- photo. Linked to the TYRE_MOUNTING row the swap created rather than
-- duplicating bus_id/axle_number/axle_side/wheel_position — those already
-- live on that row.
CREATE TABLE TYRE_SWAP (
  tyre_swap_id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tyre_mounting_id            BIGINT UNSIGNED NOT NULL,
  outgoing_tyre_id            BIGINT UNSIGNED NULL,

  -- Groove thickness readings (mm) taken off the outgoing tyre just before
  -- it came off — NULL across the board when this was a first-time mount
  -- into an empty position (nothing to remove).
  outgoing_thickness_1        DECIMAL(4,1) NULL,
  outgoing_thickness_2        DECIMAL(4,1) NULL,
  outgoing_thickness_3        DECIMAL(4,1) NULL,
  outgoing_thickness_4        DECIMAL(4,1) NULL,
  outgoing_sidewall_condition ENUM('ok','not_ok') NULL,

  -- Groove thickness readings (mm) taken off the incoming tyre at fitment.
  incoming_thickness_1        DECIMAL(4,1) NULL,
  incoming_thickness_2        DECIMAL(4,1) NULL,
  incoming_thickness_3        DECIMAL(4,1) NULL,
  incoming_thickness_4        DECIMAL(4,1) NULL,
  incoming_tyre_pressure      DECIMAL(5,1) NULL,

  install_photo_s3_bucket     VARCHAR(255) NULL,
  install_photo_s3_key        VARCHAR(255) NULL,

  performed_by                BIGINT UNSIGNED NOT NULL,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_tyre_swap_mounting FOREIGN KEY (tyre_mounting_id) REFERENCES TYRE_MOUNTING(tyre_mounting_id),
  CONSTRAINT fk_tyre_swap_outgoing_tyre FOREIGN KEY (outgoing_tyre_id) REFERENCES TYRE(tyre_id),
  CONSTRAINT fk_tyre_swap_performed_by FOREIGN KEY (performed_by) REFERENCES `USER`(user_id)
);
CREATE INDEX idx_tyre_swap_mounting ON TYRE_SWAP (tyre_mounting_id);
