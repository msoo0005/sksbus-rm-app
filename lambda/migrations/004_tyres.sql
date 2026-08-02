-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — the tyre management/inspection endpoints assume these
-- tables exist.
--
-- ⚠️ Check the BUS.bus_id column's exact type/length in your database first.
-- The VARCHAR(20) used below for every bus_id FK column must match it exactly
-- or the foreign key constraints will fail to create. Adjust if needed.

CREATE TABLE TYRE (
  tyre_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tyre_serial_number VARCHAR(64) NOT NULL UNIQUE,
  tyre_brand         VARCHAR(100) NULL,
  tyre_model         VARCHAR(100) NULL,
  tyre_is_retread    TINYINT(1) NOT NULL DEFAULT 0,
  tyre_status        ENUM('spare','mounted','rejected','retreading','retired') NOT NULL DEFAULT 'spare',
  tyre_bought_date   DATE NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Append-only mounting log. Current position for a tyre = the row with
-- unmounted_at IS NULL (there should be at most one such row per tyre, and at
-- most one per bus+axle_number+axle_side+wheel_position — both enforced in
-- the Lambda's transaction logic, since MySQL has no partial/filtered unique
-- index to express "unique while unmounted_at IS NULL").
CREATE TABLE TYRE_MOUNTING (
  tyre_mounting_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tyre_id          BIGINT UNSIGNED NOT NULL,
  bus_id           VARCHAR(20) NOT NULL,
  axle_number      TINYINT UNSIGNED NOT NULL,
  axle_side        ENUM('left','right') NOT NULL,
  wheel_position   ENUM('single','inner','outer') NOT NULL DEFAULT 'single',
  mounted_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mounted_by       BIGINT UNSIGNED NULL,
  unmounted_at     DATETIME NULL,
  unmounted_by     BIGINT UNSIGNED NULL,
  unmount_reason   VARCHAR(255) NULL,
  CONSTRAINT fk_tyre_mounting_tyre FOREIGN KEY (tyre_id) REFERENCES TYRE(tyre_id),
  CONSTRAINT fk_tyre_mounting_bus FOREIGN KEY (bus_id) REFERENCES BUS(bus_id),
  CONSTRAINT fk_tyre_mounting_mounted_by FOREIGN KEY (mounted_by) REFERENCES `USER`(user_id),
  CONSTRAINT fk_tyre_mounting_unmounted_by FOREIGN KEY (unmounted_by) REFERENCES `USER`(user_id)
);
CREATE INDEX idx_tyre_mounting_tyre_open ON TYRE_MOUNTING (tyre_id, unmounted_at);
CREATE INDEX idx_tyre_mounting_bus_open ON TYRE_MOUNTING (bus_id, unmounted_at);

-- One row per bus visit — the paper form's header (bus, technician, date, odometer).
CREATE TABLE TYRE_INSPECTION_SESSION (
  tyre_inspection_session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bus_id              VARCHAR(20) NOT NULL,
  technician_user_id  BIGINT UNSIGNED NOT NULL,
  inspection_datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  odometer_reading    INT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tyre_session_bus FOREIGN KEY (bus_id) REFERENCES BUS(bus_id),
  CONSTRAINT fk_tyre_session_tech FOREIGN KEY (technician_user_id) REFERENCES `USER`(user_id)
);
CREATE INDEX idx_tyre_session_bus_date ON TYRE_INSPECTION_SESSION (bus_id, inspection_datetime DESC);

-- One row per tyre examined within a session.
CREATE TABLE TYRE_INSPECTION (
  tyre_inspection_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id           BIGINT UNSIGNED NOT NULL,
  tyre_id              BIGINT UNSIGNED NOT NULL,
  tyre_pressure        DECIMAL(5,1) NULL,
  is_retread_confirmed TINYINT(1) NULL,
  inspection_result    ENUM('pass','monitor','reject') NOT NULL DEFAULT 'pass',
  reject_reason        VARCHAR(255) NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tyre_inspection_session FOREIGN KEY (session_id) REFERENCES TYRE_INSPECTION_SESSION(tyre_inspection_session_id),
  CONSTRAINT fk_tyre_inspection_tyre FOREIGN KEY (tyre_id) REFERENCES TYRE(tyre_id),
  UNIQUE KEY uq_tyre_inspection_session_tyre (session_id, tyre_id)
);

-- Tread groove readings for a per-tyre inspection (up to 4 grooves per the
-- paper form). Inherits its timestamp from the parent session rather than
-- carrying its own, so there's one source of truth for "when."
CREATE TABLE TYRE_TREAD (
  tyre_tread_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tyre_inspection_id BIGINT UNSIGNED NOT NULL,
  tread_position     TINYINT UNSIGNED NOT NULL,
  tread_thickness_mm DECIMAL(4,1) NOT NULL,
  CONSTRAINT fk_tyre_tread_inspection FOREIGN KEY (tyre_inspection_id) REFERENCES TYRE_INSPECTION(tyre_inspection_id),
  UNIQUE KEY uq_tyre_tread_position (tyre_inspection_id, tread_position)
);

-- Generic key-value settings store (reusable beyond tyres later).
CREATE TABLE IF NOT EXISTS APP_SETTING (
  setting_key   VARCHAR(64) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    BIGINT UNSIGNED NULL,
  CONSTRAINT fk_app_setting_user FOREIGN KEY (updated_by) REFERENCES `USER`(user_id)
);
INSERT INTO APP_SETTING (setting_key, setting_value) VALUES ('tyre_inspection_interval_days', '30');
