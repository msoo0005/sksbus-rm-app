-- Run this against your RDS/MySQL database before deploying the updated
-- lambda/index.mjs — adds a canonical "how many tread grooves does this tyre
-- model have" field to TYRE, set when a tyre is added to the system (e.g.
-- Long March LM 666 = 4, Long March LM 668 = 3, GITI GT 867 = 4). This is
-- distinct from tyre_retread_count (how many times it's been retreaded).
--
-- Existing 'DEMO-...' tyres from 005 are backfilled to match the counts used
-- for their tread readings in that seed data.

ALTER TABLE TYRE
  ADD COLUMN tyre_tread_count INT UNSIGNED NOT NULL DEFAULT 4 AFTER tyre_retread_count;

UPDATE TYRE SET tyre_tread_count = 4 WHERE tyre_serial_number IN ('DEMO-LM666-01','DEMO-LM666-02','DEMO-GT867-01','DEMO-GT867-02','DEMO-GT867-03');
UPDATE TYRE SET tyre_tread_count = 3 WHERE tyre_serial_number IN ('DEMO-LM668-01','DEMO-LM668-02','DEMO-LM668-03');
