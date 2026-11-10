-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs. Same ordering rule as 014 and 015:
--
--   * Old Lambda + new columns -> fine. Every column here is nullable and the
--     currently deployed code never mentions them.
--   * New Lambda + old schema  -> BROKEN. swapTyre's INSERT names these columns
--     explicitly, so every tyre replacement 500s until they exist.
--
-- So: migrate first, deploy second.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- A sidewall marked NC is a safety finding, and a finding with no photograph is
-- one person's word against a casing that may already have been scrapped. The
-- inspection form has been able to attach a sidewall photo since 014, but the
-- TYRE REPLACEMENT form never could — and it is the form that judges TWO
-- sidewalls, the tyre coming off and the tyre going on, at the moment the
-- evidence is physically in the technician's hands. Both are now mandatory
-- whenever the condition is 'not_ok'.
--
-- Two separate pairs rather than one: the outgoing and incoming tyres are
-- different casings and can each be NC independently, so a single photo column
-- could not say which tyre it showed.
-- ---------------------------------------------------------------------------

ALTER TABLE TYRE_SWAP
  ADD COLUMN outgoing_sidewall_photo_s3_bucket VARCHAR(255) NULL
      AFTER outgoing_sidewall_condition,
  ADD COLUMN outgoing_sidewall_photo_s3_key    VARCHAR(255) NULL
      AFTER outgoing_sidewall_photo_s3_bucket,
  ADD COLUMN incoming_sidewall_photo_s3_bucket VARCHAR(255) NULL
      AFTER incoming_sidewall_condition,
  ADD COLUMN incoming_sidewall_photo_s3_key    VARCHAR(255) NULL
      AFTER incoming_sidewall_photo_s3_bucket;

-- ---------------------------------------------------------------------------
-- NO DATA IS REWRITTEN, AND NO BACKFILL IS POSSIBLE.
--
-- Swaps already recorded with an NC sidewall have no photograph and never will.
-- They stay NULL, and the requirement applies only to swaps filed from here on;
-- nothing reads these columns as "must be present" except the write path.
--
-- The same is true of TYRE_INSPECTION.sidewall_photo_s3_key, which 014 added as
-- optional and the Lambda now requires. Rows written between 014 and this
-- change may carry an NC sidewall with a note and no photo. To find them:
--
--   SELECT ti.tyre_inspection_id, s.bus_id, s.inspection_datetime, ti.sidewall_note
--   FROM TYRE_INSPECTION ti
--   JOIN TYRE_INSPECTION_SESSION s ON s.tyre_inspection_session_id = ti.session_id
--   WHERE ti.sidewall_condition = 'not_ok' AND ti.sidewall_photo_s3_key IS NULL
--   ORDER BY s.inspection_datetime DESC;
-- ---------------------------------------------------------------------------
