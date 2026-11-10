-- Run this against your RDS/MySQL database BEFORE deploying the updated
-- lambda/index.mjs. Same ordering rule as 014-016:
--
--   * Old Lambda + new columns -> fine. Both are nullable and unreferenced by
--     the currently deployed code.
--   * New Lambda + old schema  -> BROKEN. createTyre and
--     createTyreInspectionSession both name these columns in their INSERTs, so
--     adding a tyre and filing an inspection would each 500.
--
-- So: migrate first, deploy second.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- A retread count is a claim about a casing's remaining life, and the ceiling
-- (TYRE_MAX_RETREAD_BUCKET = 3) is the point at which a casing is scrapped. It
-- is read off a sticker on the tyre, so the sticker is the evidence — and the
-- count is written with GREATEST(), meaning it can only ever go up and a
-- mistake can never be corrected downwards through the app.
--
-- Three forms let someone set that count: the tyre REPLACEMENT popup, which has
-- required a sticker photo since 009; the periodic INSPECTION, which records
-- retread_count_observed; and the ADD TYRE form, which sets it on a casing
-- entering stock. Only the first could attach the photo. Now all three must,
-- whenever the count is 1 or more.
--
-- A never-retreaded casing (count 0) has no sticker to photograph, so nothing
-- is required of it.
-- ---------------------------------------------------------------------------

ALTER TABLE TYRE_INSPECTION
  ADD COLUMN retread_sticker_s3_bucket VARCHAR(255) NULL AFTER retread_count_observed,
  ADD COLUMN retread_sticker_s3_key    VARCHAR(255) NULL AFTER retread_sticker_s3_bucket;

-- On TYRE itself, this is the sticker for the count the casing currently
-- carries — set when it enters stock and replaced whenever a later reading
-- raises the count. TYRE_SWAP and TYRE_INSPECTION keep their own copies as the
-- per-event record of what was seen at that moment; this is the latest one.
ALTER TABLE TYRE
  ADD COLUMN retread_sticker_s3_bucket VARCHAR(255) NULL AFTER tyre_retread_count,
  ADD COLUMN retread_sticker_s3_key    VARCHAR(255) NULL AFTER retread_sticker_s3_bucket;

-- ---------------------------------------------------------------------------
-- NO BACKFILL IS POSSIBLE. Casings already carrying a retread count above zero
-- have no sticker photograph on file and never will; the requirement applies to
-- writes from here on. To see how many are affected:
--
--   SELECT tyre_retread_count, COUNT(*)
--   FROM TYRE
--   WHERE tyre_retread_count > 0 AND retread_sticker_s3_key IS NULL
--   GROUP BY tyre_retread_count ORDER BY tyre_retread_count;
--
-- The next inspection or replacement that records a count for one of these will
-- capture its sticker, so the gap closes on its own as the fleet is worked
-- through rather than needing a sweep.
-- ---------------------------------------------------------------------------
