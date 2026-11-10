-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs. THE ORDER MATTERS IN ONE DIRECTION:
--
--   * Old Lambda + new schema  -> fine. Every column here is nullable or
--     defaulted, so nothing currently deployed notices them.
--   * New Lambda + old schema  -> BROKEN. LATEST_TYRE_INSPECTION_SQL selects
--     uneven_wear_type and tread_spread_mm, and it backs the low-tread list,
--     the nightly tyre digest AND the new fleet summary. All three 500 until
--     this migration has run.
--
-- So: migrate first, deploy second. Never the other way round.
--
-- Four things the inspection form now records that had nowhere to go:
--
-- 1. A sidewall finding is no longer just OK/NC. When a technician marks NC
--    they must say what they saw and photograph it, so a manager reviewing the
--    session sees the damage rather than a two-letter flag.
-- 2. The pass/monitor/reject verdict stopped being a dropdown and became a
--    derivation from the readings (tread depth, sidewall, wear pattern). The
--    verdict column itself is unchanged; result_source records which regime
--    wrote each row.
-- 3. Uneven wear is detected from the spread between groove readings and
--    classified by cause. Stored so the report screen can show the finding
--    without re-deriving it from TYRE_TREAD every time.
-- 4. tread_spread_mm is the max-minus-min that triggered (or didn't trigger)
--    that classification, kept so the number behind the label is auditable.

ALTER TABLE TYRE_INSPECTION
  -- What was wrong with the sidewall. Required by the Lambda whenever
  -- sidewall_condition = 'not_ok'; always NULL when it is 'ok'.
  ADD COLUMN sidewall_note            VARCHAR(500) NULL AFTER sidewall_condition,
  ADD COLUMN sidewall_photo_s3_bucket VARCHAR(255) NULL AFTER sidewall_note,
  ADD COLUMN sidewall_photo_s3_key    VARCHAR(255) NULL AFTER sidewall_photo_s3_bucket,

  -- NULL means "no uneven wear detected", which is the common case — an enum
  -- with no 'none' member keeps that distinction free of a magic value.
  -- Classified by CAUSE only: nothing in this system records which way round a
  -- tyre was fitted, so a label naming a side (toe-in vs toe-out) would be a
  -- guess. 'alignment' deliberately covers both toe and camber.
  ADD COLUMN uneven_wear_type
      ENUM('alignment','under_inflation','over_inflation','imbalance') NULL
      AFTER retread_count_observed,
  ADD COLUMN tread_spread_mm          DECIMAL(4,1) NULL AFTER uneven_wear_type,

  -- DEFAULT 'manual' so every row already in the table is correctly labelled
  -- without an UPDATE touching thousands of historic inspections. The new
  -- Lambda always writes 'derived' explicitly.
  ADD COLUMN result_source ENUM('manual','derived') NOT NULL DEFAULT 'manual'
      AFTER inspection_result;

-- ---------------------------------------------------------------------------
-- No index is added here: TYRE_INSPECTION(tyre_id) is already covered by the
-- implicit index behind fk_tyre_inspection_tyre (004_tyres.sql), which is what
-- the new fleet-summary query's latest-inspection subquery groups on.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- NO DATA IS REWRITTEN BY THIS MIGRATION. One thing nonetheless changes
-- meaning, and it needs a human to follow up.
--
-- The retread bucket ceiling moves from 2 to 3. Under the old scheme a stored
-- 2 meant "two OR MORE" and displayed as "2+". Under the new scheme a stored 2
-- means exactly two and displays "2". Any casing recorded as "2+" while
-- physically on its third retread will now under-report by one.
--
-- There is no way to tell those apart from the data, so nothing is guessed
-- here. Run the SELECT below and re-read the stickers on what it lists.
--
-- Legacy rows holding MORE than 3 are left alone: they clamp to 3 on read
-- (retreadBucket) and the GREATEST() writes mean they can never move down.
--
--   SELECT t.tyre_id, t.tyre_serial_number, t.tyre_retread_count,
--          m.bus_id, m.axle_number, m.axle_side, m.wheel_position
--   FROM TYRE t
--   LEFT JOIN TYRE_MOUNTING m
--          ON m.tyre_id = t.tyre_id AND m.unmounted_at IS NULL
--   WHERE t.tyre_retread_count >= 2
--   ORDER BY t.tyre_retread_count DESC, m.bus_id;
-- ---------------------------------------------------------------------------
