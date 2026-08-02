-- 004_tyres.sql guessed BUS.bus_id was VARCHAR(20). Your real BUS rows
-- (e.g. 'GOKL-001', 'MBSJ-005') show it's a short code column, but the exact
-- type/length/charset/collation still has to match EXACTLY for a foreign key
-- to be created — if it doesn't, MySQL fails the whole CREATE TABLE
-- statement with an errno-150 "foreign key constraint is incorrectly
-- formed" error.
--
-- That means TYRE_MOUNTING and TYRE_INSPECTION_SESSION (both FK to
-- BUS(bus_id)) almost certainly never got created, and everything chained
-- off them — TYRE_INSPECTION, TYRE_TREAD, and (since a `mysql < file.sql`
-- run stops at the first error) probably APP_SETTING and all of 005's demo
-- mounting/inspection/tread rows — never ran either. Every /tyres endpoint
-- that touches mounting or inspections then fails at query time with a
-- "table doesn't exist" error, which is the underlying cause of the
-- "Not Found" you were seeing.
--
-- Rather than guess the real type again, this migration reads BUS.bus_id's
-- actual column type/charset/collation live from information_schema and
-- rebuilds the dependent tables to match it exactly, then re-seeds the demo
-- mounting/inspection/tread data from 005 (the TYRE rows themselves — the 9
-- 'DEMO-...' tyres — should already exist and are left untouched).
--
-- ⚠️ This DROPs and recreates TYRE_MOUNTING, TYRE_INSPECTION_SESSION,
-- TYRE_INSPECTION and TYRE_TREAD. That's safe here because if you're hitting
-- this bug, those tables never successfully held any data to begin with. If
-- you want to double check first, run:
--   SHOW CREATE TABLE BUS;
--   SELECT COUNT(*) FROM TYRE_MOUNTING;
-- (an error on the second query — "doesn't exist" — confirms you're in the
-- failure state this migration fixes).

SET @bus_col_type  := (SELECT COLUMN_TYPE       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BUS' AND COLUMN_NAME = 'bus_id');
SET @bus_charset   := (SELECT CHARACTER_SET_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BUS' AND COLUMN_NAME = 'bus_id');
SET @bus_collation := (SELECT COLLATION_NAME     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BUS' AND COLUMN_NAME = 'bus_id');

-- ---------------------------------------------------------------------------
-- Drop the (probably nonexistent, possibly wrongly-typed) dependent tables,
-- in FK-safe order.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS TYRE_TREAD;
DROP TABLE IF EXISTS TYRE_INSPECTION;
DROP TABLE IF EXISTS TYRE_INSPECTION_SESSION;
DROP TABLE IF EXISTS TYRE_MOUNTING;

-- ---------------------------------------------------------------------------
-- Recreate TYRE_MOUNTING and TYRE_INSPECTION_SESSION with a bus_id column
-- that exactly matches BUS.bus_id (built dynamically, since PREPARE can't
-- take column-type placeholders directly).
-- ---------------------------------------------------------------------------
SET @sql := CONCAT(
  'CREATE TABLE TYRE_MOUNTING (
    tyre_mounting_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tyre_id          BIGINT UNSIGNED NOT NULL,
    bus_id           ', @bus_col_type, ' CHARACTER SET ', @bus_charset, ' COLLATE ', @bus_collation, ' NOT NULL,
    axle_number      TINYINT UNSIGNED NOT NULL,
    axle_side        ENUM(''left'',''right'') NOT NULL,
    wheel_position   ENUM(''single'',''inner'',''outer'') NOT NULL DEFAULT ''single'',
    mounted_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    mounted_by       BIGINT UNSIGNED NULL,
    unmounted_at     DATETIME NULL,
    unmounted_by     BIGINT UNSIGNED NULL,
    unmount_reason   VARCHAR(255) NULL,
    CONSTRAINT fk_tyre_mounting_tyre FOREIGN KEY (tyre_id) REFERENCES TYRE(tyre_id),
    CONSTRAINT fk_tyre_mounting_bus FOREIGN KEY (bus_id) REFERENCES BUS(bus_id),
    CONSTRAINT fk_tyre_mounting_mounted_by FOREIGN KEY (mounted_by) REFERENCES `USER`(user_id),
    CONSTRAINT fk_tyre_mounting_unmounted_by FOREIGN KEY (unmounted_by) REFERENCES `USER`(user_id)
  )'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE INDEX idx_tyre_mounting_tyre_open ON TYRE_MOUNTING (tyre_id, unmounted_at);
CREATE INDEX idx_tyre_mounting_bus_open ON TYRE_MOUNTING (bus_id, unmounted_at);

SET @sql := CONCAT(
  'CREATE TABLE TYRE_INSPECTION_SESSION (
    tyre_inspection_session_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bus_id              ', @bus_col_type, ' CHARACTER SET ', @bus_charset, ' COLLATE ', @bus_collation, ' NOT NULL,
    technician_user_id  BIGINT UNSIGNED NOT NULL,
    inspection_datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    odometer_reading    INT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tyre_session_bus FOREIGN KEY (bus_id) REFERENCES BUS(bus_id),
    CONSTRAINT fk_tyre_session_tech FOREIGN KEY (technician_user_id) REFERENCES `USER`(user_id)
  )'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE INDEX idx_tyre_session_bus_date ON TYRE_INSPECTION_SESSION (bus_id, inspection_datetime DESC);

-- ---------------------------------------------------------------------------
-- These two don't reference BUS at all, so they can be created as plain
-- static SQL — column names already reflect 005's retread_count_observed
-- rename since that table is being created fresh here.
-- ---------------------------------------------------------------------------
CREATE TABLE TYRE_INSPECTION (
  tyre_inspection_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id             BIGINT UNSIGNED NOT NULL,
  tyre_id                BIGINT UNSIGNED NOT NULL,
  tyre_pressure          DECIMAL(5,1) NULL,
  retread_count_observed INT UNSIGNED NULL,
  inspection_result      ENUM('pass','monitor','reject') NOT NULL DEFAULT 'pass',
  reject_reason          VARCHAR(255) NULL,
  created_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tyre_inspection_session FOREIGN KEY (session_id) REFERENCES TYRE_INSPECTION_SESSION(tyre_inspection_session_id),
  CONSTRAINT fk_tyre_inspection_tyre FOREIGN KEY (tyre_id) REFERENCES TYRE(tyre_id),
  UNIQUE KEY uq_tyre_inspection_session_tyre (session_id, tyre_id)
);

CREATE TABLE TYRE_TREAD (
  tyre_tread_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tyre_inspection_id BIGINT UNSIGNED NOT NULL,
  tread_position     TINYINT UNSIGNED NOT NULL,
  tread_thickness_mm DECIMAL(4,1) NOT NULL,
  CONSTRAINT fk_tyre_tread_inspection FOREIGN KEY (tyre_inspection_id) REFERENCES TYRE_INSPECTION(tyre_inspection_id),
  UNIQUE KEY uq_tyre_tread_position (tyre_inspection_id, tread_position)
);

-- In case 004 aborted before reaching this (guarded, so harmless either way).
CREATE TABLE IF NOT EXISTS APP_SETTING (
  setting_key   VARCHAR(64) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    BIGINT UNSIGNED NULL,
  CONSTRAINT fk_app_setting_user FOREIGN KEY (updated_by) REFERENCES `USER`(user_id)
);
INSERT IGNORE INTO APP_SETTING (setting_key, setting_value) VALUES ('tyre_inspection_interval_days', '30');

-- ---------------------------------------------------------------------------
-- Re-seed the demo mounting + inspection + tread data from 005 (it never
-- actually ran, since the tables above didn't exist). The 9 'DEMO-...' TYRE
-- rows themselves aren't touched here — they should already exist.
-- ---------------------------------------------------------------------------
SET @demo_bus  := (SELECT bus_id  FROM BUS            ORDER BY bus_id  ASC LIMIT 1);
SET @demo_tech := (SELECT user_id FROM `USER` WHERE user_role='technician'             ORDER BY user_id ASC LIMIT 1);
SET @demo_mgr  := (SELECT user_id FROM `USER` WHERE user_role IN ('rm_manager','admin') ORDER BY user_id ASC LIMIT 1);

INSERT INTO TYRE_MOUNTING (tyre_id, bus_id, axle_number, axle_side, wheel_position, mounted_by)
SELECT t.tyre_id, @demo_bus, v.axle_number, v.axle_side, v.wheel_position, @demo_mgr
FROM TYRE t
JOIN (
  SELECT 'DEMO-LM666-01' AS serial, 1 AS axle_number, 'left'  AS axle_side, 'single' AS wheel_position
  UNION ALL SELECT 'DEMO-LM666-02', 1, 'right', 'single'
  UNION ALL SELECT 'DEMO-LM668-01', 2, 'left',  'outer'
  UNION ALL SELECT 'DEMO-LM668-02', 2, 'left',  'inner'
  UNION ALL SELECT 'DEMO-GT867-01', 2, 'right', 'inner'
  UNION ALL SELECT 'DEMO-GT867-02', 2, 'right', 'outer'
) v ON v.serial = t.tyre_serial_number
WHERE @demo_bus IS NOT NULL;

UPDATE TYRE SET tyre_status='mounted'
WHERE tyre_serial_number IN ('DEMO-LM666-01','DEMO-LM666-02','DEMO-LM668-01','DEMO-LM668-02','DEMO-GT867-01','DEMO-GT867-02')
  AND @demo_bus IS NOT NULL;

INSERT INTO TYRE_INSPECTION_SESSION (bus_id, technician_user_id, inspection_datetime, odometer_reading)
SELECT @demo_bus, @demo_tech, '2026-07-20 09:00:00', 128450
WHERE @demo_bus IS NOT NULL AND @demo_tech IS NOT NULL;

SET @demo_session := (
  SELECT tyre_inspection_session_id FROM TYRE_INSPECTION_SESSION
  WHERE bus_id=@demo_bus AND technician_user_id=@demo_tech AND inspection_datetime='2026-07-20 09:00:00'
  LIMIT 1
);

INSERT INTO TYRE_INSPECTION (session_id, tyre_id, tyre_pressure, retread_count_observed, inspection_result, reject_reason)
SELECT @demo_session, t.tyre_id, v.pressure, t.tyre_retread_count, v.result, NULL
FROM TYRE t
JOIN (
  SELECT 'DEMO-LM666-01' AS serial, 120.0 AS pressure, 'pass'    AS result
  UNION ALL SELECT 'DEMO-LM666-02', 118.5, 'pass'
  UNION ALL SELECT 'DEMO-LM668-01', 115.0, 'pass'
  UNION ALL SELECT 'DEMO-LM668-02', 110.0, 'monitor'
  UNION ALL SELECT 'DEMO-GT867-01', 122.0, 'pass'
  UNION ALL SELECT 'DEMO-GT867-02', 119.0, 'pass'
) v ON v.serial = t.tyre_serial_number
WHERE @demo_session IS NOT NULL;

INSERT INTO TYRE_TREAD (tyre_inspection_id, tread_position, tread_thickness_mm)
SELECT ti.tyre_inspection_id, v.tread_position, v.thickness
FROM TYRE_INSPECTION ti
JOIN TYRE t ON t.tyre_id = ti.tyre_id
JOIN (
  SELECT 'DEMO-LM666-01' AS serial, 1 AS tread_position, 8.5 AS thickness
  UNION ALL SELECT 'DEMO-LM666-01', 2, 8.2
  UNION ALL SELECT 'DEMO-LM666-01', 3, 8.4
  UNION ALL SELECT 'DEMO-LM666-01', 4, 8.6
  UNION ALL SELECT 'DEMO-LM666-02', 1, 7.0
  UNION ALL SELECT 'DEMO-LM666-02', 2, 6.8
  UNION ALL SELECT 'DEMO-LM666-02', 3, 7.1
  UNION ALL SELECT 'DEMO-LM666-02', 4, 6.9
  UNION ALL SELECT 'DEMO-LM668-01', 1, 6.5
  UNION ALL SELECT 'DEMO-LM668-01', 2, 6.3
  UNION ALL SELECT 'DEMO-LM668-01', 3, 6.4
  UNION ALL SELECT 'DEMO-LM668-02', 1, 5.5
  UNION ALL SELECT 'DEMO-LM668-02', 2, 4.2
  UNION ALL SELECT 'DEMO-LM668-02', 3, 5.0
  UNION ALL SELECT 'DEMO-GT867-01', 1, 9.0
  UNION ALL SELECT 'DEMO-GT867-01', 2, 8.8
  UNION ALL SELECT 'DEMO-GT867-01', 3, 9.1
  UNION ALL SELECT 'DEMO-GT867-01', 4, 8.9
  UNION ALL SELECT 'DEMO-GT867-02', 1, 7.5
  UNION ALL SELECT 'DEMO-GT867-02', 2, 7.3
  UNION ALL SELECT 'DEMO-GT867-02', 3, 7.6
  UNION ALL SELECT 'DEMO-GT867-02', 4, 7.4
) v ON v.serial = t.tyre_serial_number
WHERE ti.session_id = @demo_session AND @demo_session IS NOT NULL;
