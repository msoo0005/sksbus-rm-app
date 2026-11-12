-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs.
--
-- A new tyre's groove thickness is now recorded when it is added to stock
-- (one reading per groove, 3 or 4). Spares are on no bus, so these can't be
-- an inspection; they live on the TYRE row itself, one column per groove like
-- TYRE_SWAP. When the tyre is later fitted, Tyre Replacement pre-fills its
-- "incoming thickness" from them. Tyres added before this change have none.

ALTER TABLE TYRE
  ADD COLUMN intake_thickness_1 DECIMAL(4,1) NULL,
  ADD COLUMN intake_thickness_2 DECIMAL(4,1) NULL,
  ADD COLUMN intake_thickness_3 DECIMAL(4,1) NULL,
  ADD COLUMN intake_thickness_4 DECIMAL(4,1) NULL,
  ADD COLUMN intake_measured_at DATETIME NULL,
  ADD COLUMN intake_measured_by BIGINT NULL;

-- Check
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TYRE' AND COLUMN_NAME LIKE 'intake_%';
