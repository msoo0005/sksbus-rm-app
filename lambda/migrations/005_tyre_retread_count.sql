-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — replaces the "is this a retread? Y/N" flag with a
-- running count of how many times a tyre has been retreaded (0 = new tyre,
-- 1 = retreaded once, 2 = retreaded twice, etc).
--
-- Safe to run whether or not 004_tyres.sql's TINYINT(1) columns already hold
-- 0/1 data — those values remain valid under the wider INT UNSIGNED type.

ALTER TABLE TYRE
  CHANGE COLUMN tyre_is_retread tyre_retread_count INT UNSIGNED NOT NULL DEFAULT 0;

ALTER TABLE TYRE_INSPECTION
  CHANGE COLUMN is_retread_confirmed retread_count_observed INT UNSIGNED NULL;

-- ---------------------------------------------------------------------------
-- Dummy tyre inventory + one inspection session, so the tyre-management
-- screens have real data to show out of the box (the bus diagram, the spares
-- list, and the low-tread alert). All serials are prefixed "DEMO-" so they're
-- easy to find and delete later.
--
-- 9 tyres are created across the three models actually run by the fleet.
-- "Threads" below = groove/tread positions per tyre (this is what
-- TYRE_TREAD.tread_position 1..N records): Long March LM 666 = 4, Long March
-- LM 668 = 3, GITI GT 867 = 4.
--
-- 6 of the 9 are mounted onto the first bus found in BUS (filling the full
-- 6-position diagram); the other 3 are left as spares. One inspection session
-- is recorded for that bus, with tread readings for every mounted tyre — one
-- of them (DEMO-LM668-02) deliberately has a groove reading of 4.2mm, under
-- the 5mm low-tread alert threshold, so that alert has something to show.
--
-- All of this is skipped automatically (inserts 0 rows) if your BUS or USER
-- tables are empty — it only needs an existing bus, and only needs a
-- technician/rm_manager user to attribute the mounting/inspection to.
-- ---------------------------------------------------------------------------

INSERT INTO TYRE (tyre_serial_number, tyre_brand, tyre_model, tyre_retread_count, tyre_status, tyre_bought_date) VALUES
  ('DEMO-LM666-01', 'Long March', 'LM 666', 0, 'spare', '2026-01-10'),
  ('DEMO-LM666-02', 'Long March', 'LM 666', 1, 'spare', '2025-06-02'),
  ('DEMO-LM666-03', 'Long March', 'LM 666', 0, 'spare', '2026-03-18'),
  ('DEMO-LM668-01', 'Long March', 'LM 668', 0, 'spare', '2026-02-01'),
  ('DEMO-LM668-02', 'Long March', 'LM 668', 2, 'spare', '2024-11-20'),
  ('DEMO-LM668-03', 'Long March', 'LM 668', 1, 'spare', '2025-09-05'),
  ('DEMO-GT867-01',  'GITI',       'GT 867', 0, 'spare', '2026-01-25'),
  ('DEMO-GT867-02',  'GITI',       'GT 867', 1, 'spare', '2025-04-14'),
  ('DEMO-GT867-03',  'GITI',       'GT 867', 3, 'spare', '2023-08-30');

SET @demo_bus  := (SELECT bus_id  FROM BUS            ORDER BY bus_id  ASC LIMIT 1);
SET @demo_tech := (SELECT user_id FROM `USER` WHERE user_role='technician'                 ORDER BY user_id ASC LIMIT 1);
SET @demo_mgr  := (SELECT user_id FROM `USER` WHERE user_role IN ('rm_manager','admin')     ORDER BY user_id ASC LIMIT 1);

-- Mount 6 of the 9 tyres onto @demo_bus (front L/R + rear L/R outer/inner).
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

-- One inspection session for @demo_bus, dated a couple of weeks ago.
INSERT INTO TYRE_INSPECTION_SESSION (bus_id, technician_user_id, inspection_datetime, odometer_reading)
SELECT @demo_bus, @demo_tech, '2026-07-20 09:00:00', 128450
WHERE @demo_bus IS NOT NULL AND @demo_tech IS NOT NULL;

SET @demo_session := (
  SELECT tyre_inspection_session_id FROM TYRE_INSPECTION_SESSION
  WHERE bus_id=@demo_bus AND technician_user_id=@demo_tech AND inspection_datetime='2026-07-20 09:00:00'
  LIMIT 1
);

-- One TYRE_INSPECTION row per mounted tyre. DEMO-LM668-02 is marked
-- "monitor" — its tread readings below intentionally dip under 5mm.
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

-- Tread groove readings — 4 grooves for LM 666 / GT 867, 3 for LM 668, per
-- the thread counts given for these models. DEMO-LM668-02's groove 2 reads
-- 4.2mm, under the 5mm low-tread alert threshold.
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
